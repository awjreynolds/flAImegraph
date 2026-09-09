from __future__ import annotations
import copy
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import time

output=Path(sys.argv[1]).resolve()
workspace=Path(tempfile.mkdtemp(prefix='headroom-integration-'))
assert importlib.metadata.version('headroom-ai') == '0.37.0'
for k in list(os.environ):
    if k.startswith(('HEADROOM_', 'ANTHROPIC_', 'OPENAI_', 'CODEX_', 'LANGFUSE_', 'OTEL_')):
        del os.environ[k]
os.environ.update(HEADROOM_WORKSPACE_DIR=str(workspace), HEADROOM_OFFLINE='1', HEADROOM_BEACON='off', HEADROOM_TELEMETRY='off', HEADROOM_DISABLE_KOMPRESS='1', HEADROOM_UPDATE_CHECK='off', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', LITELLM_LOCAL_MODEL_COST_MAP='True')
os.chdir(workspace)
# External network is forbidden; TestClient and MockTransport are in-process.
network_attempts=[]
def deny_connect(self,address):
    network_attempts.append(str(address))
    raise OSError('external network disabled by integration probe')
socket.socket.connect=deny_connect
import httpx
from fastapi.testclient import TestClient
from headroom.proxy.server import ProxyConfig, create_app

results=[]
captured=[]
mode='ok'
model='claude-sonnet-4-6'
body={'model':model,'max_tokens':64,'system':'Synthetic system instruction.','messages':[{'role':'user','content':'Return the word ok.'}],'tools':[{'name':'read_file','description':'Read synthetic file','input_schema':{'type':'object','properties':{'path':{'type':'string'}},'required':['path']}}]}

def upstream(request):
    data=json.loads(request.content)
    captured.append({'method':request.method,'path':request.url.path,'body':data})
    if mode=='error':
        return httpx.Response(529,json={'type':'error','error':{'type':'overloaded_error','message':'synthetic overload'}},request=request)
    if mode=='disconnect':
        raise httpx.ConnectError('synthetic disconnect',request=request)
    if request.url.path.endswith('/responses'):
        result={'id':'resp_synthetic','object':'response','status':'completed','model':data['model'],'output':[{'id':'msg_out','type':'message','role':'assistant','content':[{'type':'output_text','text':'ok','annotations':[]}]}],'usage':{'input_tokens':41,'output_tokens':3,'total_tokens':44,'input_tokens_details':{'cached_tokens':11}}}
        if data.get('stream'):
            payload='event: response.completed\ndata: '+json.dumps({'type':'response.completed','response':result})+'\n\n'
            return httpx.Response(200,content=payload.encode(),headers={'content-type':'text/event-stream'},request=request)
        return httpx.Response(200,json=result,request=request)
    if data.get('stream'):
        frames=[('message_start',{'type':'message_start','message':{'id':'msg_synthetic','type':'message','role':'assistant','model':model,'content':[],'usage':{'input_tokens':37,'output_tokens':0}}}),('content_block_delta',{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'ok'}}),('message_delta',{'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':{'output_tokens':2}}),('message_stop',{'type':'message_stop'})]
        payload=''.join('event: '+event+'\ndata: '+json.dumps(value)+'\n\n' for event,value in frames)
        if mode=='partial':
            class BrokenStream(httpx.AsyncByteStream):
                async def __aiter__(self):
                    yield payload.split('event: message_delta')[0].encode()
                    raise httpx.ReadError('synthetic partial stream')
            return httpx.Response(200,stream=BrokenStream(),headers={'content-type':'text/event-stream'},request=request)
        return httpx.Response(200,content=payload.encode(),headers={'content-type':'text/event-stream'},request=request)
    return httpx.Response(200,json={'id':'msg_synthetic','type':'message','role':'assistant','content':[{'type':'text','text':'ok'}],'model':model,'stop_reason':'end_turn','usage':{'input_tokens':37,'output_tokens':2}},request=request)

config=ProxyConfig(optimize=False,cache_enabled=False,rate_limit_enabled=False,cost_tracking_enabled=False,log_requests=True,log_file=str(workspace/'requests.jsonl'),ccr_inject_tool=False,ccr_inject_marker=False,memory_enabled=False,traffic_learning_enabled=False,proxy_extensions=[])
app=create_app(config)
# Avoid startup warmups/background services; route and proxy methods are real.
proxy=app.state.proxy
proxy.http_client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
client=TestClient(app)
for label,scenario,stream in [('nonstream_success','ok',False),('stream_success','ok',True),('stream_529','error',True),('stream_disconnect','disconnect',True),('stream_partial','partial',True),('responses_success','ok',False),('responses_stream','ok',True)]:
    mode=scenario
    incoming=copy.deepcopy(body)
    incoming['stream']=stream
    route='/v1/messages'
    if label.startswith('responses'):
        route='/v1/responses'
        incoming={'model':'gpt-5','input':[{'role':'user','content':'Return the word ok.'}],'stream':stream}
    before=len(proxy.logger.get_recent(10000))
    start=time.monotonic()
    try:
        response=client.post(route,json=incoming,headers={'x-api-key':'synthetic-key','anthropic-version':'2023-06-01','authorization':'Bearer synthetic-key'})
        logs=proxy.logger.get_recent(10000)[before:]
        results.append({'case':label,'http_status':response.status_code,'response_prefix':response.text[:150],'seconds':round(time.monotonic()-start,3),'body_preserved':bool(captured and captured[-1]['body']==incoming),'changed_body_keys':[k for k in set(incoming)|set(captured[-1]['body']) if incoming.get(k)!=captured[-1]['body'].get(k)] if captured else None,'request_logs':logs})
    except Exception as exc:
        results.append({'case':label,'exception':type(exc).__name__,'message':str(exc)[:200]})
result={'package_version':importlib.metadata.version('headroom-ai'),'scope':'real ASGI route/proxy with in-process mock HTTP upstream; startup warmups excluded; no installed agent launch','network_attempts_blocked':network_attempts,'results':results}
output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
