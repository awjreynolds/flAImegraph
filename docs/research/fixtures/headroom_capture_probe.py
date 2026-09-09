"""Offline component probes of pinned Headroom source; no package installation.

Run: python3 headroom_capture_probe.py /path/to/headroom-checkout
Loads exact RequestLog AST class and actual logger/redaction modules without
Headroom package initializers. This does not test proxy routes or live agents.
"""
from __future__ import annotations
import ast
import dataclasses
import importlib.util
import json
import os
from unittest.mock import patch
from pathlib import Path
import subprocess
import sys
import tempfile
import types
from typing import Any

PIN = '3d3c629a9f349ed0f89102e32599aacea32e0b16'
root = Path(sys.argv[1]).resolve()
assert subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() == PIN
for name in ('headroom', 'headroom.proxy'):
    module = types.ModuleType(name)
    module.__path__ = [str(root / name.replace('.', '/'))]
    sys.modules[name] = module
model = types.ModuleType('headroom.proxy.models')
model.__dict__.update(dataclass=dataclasses.dataclass, field=dataclasses.field, Any=Any)
sys.modules[model.__name__] = model
tree = ast.parse((root / 'headroom/proxy/models.py').read_text())
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'RequestLog')
exec(compile(ast.Module(body=[cls], type_ignores=[]), str(root / 'headroom/proxy/models.py'), 'exec'), model.__dict__)

def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, root / relative)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

load('headroom.proxy.request_log_redaction_policy', 'headroom/proxy/request_log_redaction_policy.py')
logger_module = load('headroom.proxy.request_logger', 'headroom/proxy/request_logger.py')
RequestLogger = logger_module.RequestLogger

def entry(identifier='r1', **extra):
    data = dict(request_id=identifier, timestamp='2026-09-09T00:00:00Z',
                provider='anthropic', model='synthetic-model',
                input_tokens_original=100, input_tokens_optimized=100,
                output_tokens=None, tokens_saved=0, savings_percent=0.0,
                optimization_latency_ms=0.0, total_latency_ms=None,
                tags={}, cache_hit=False, transforms_applied=[],
                request_messages=[{'role':'user','content':'SYNTHETIC_PRIVATE_TEXT'}],
                compressed_messages=[{'role':'user','content':'SYNTHETIC_PRIVATE_TEXT'}],
                response_content='SYNTHETIC_RESPONSE')
    data.update(extra)
    return model.RequestLog(**data)

results=[]
with tempfile.TemporaryDirectory(prefix='headroom-probe-') as temp:
    dest = Path(temp) / 'requests.jsonl'
    log = RequestLogger(str(dest))
    log.log(entry())
    disk = json.loads(dest.read_text())
    assert all(k not in disk for k in ('request_messages','compressed_messages','response_content'))
    assert disk['output_tokens'] is None
    results.append({'case':'default JSONL payload omission','result':'pass','unknown_output_preserved':True})
    memory = log.get_recent_with_messages()[0]
    assert memory['request_messages'][0]['content'] == 'SYNTHETIC_PRIVATE_TEXT'
    results.append({'case':'default logger memory content','result':'retained despite log_full_messages=False'})

    bad = RequestLogger(str(Path(temp)))  # Directory exists, append-open fails.
    bad.log(entry())
    assert bad.stats()['total_logged'] == 1
    assert bad.stats()['log_file'] == temp
    assert 'error' not in bad.stats()
    results.append({'case':'append failure','result':'no exception; memory entry retained; stats has no write-failure flag'})

    duplicate = RequestLogger()
    duplicate.log(entry('same-id'))
    duplicate.log(entry('same-id'))
    assert len(duplicate.get_recent()) == 2
    results.append({'case':'same request ID logged twice','result':'two entries; no logger deduplication'})

    bounded = RequestLogger()
    for i in range(RequestLogger.MAX_LOG_ENTRIES + 1):
        bounded.log(entry(str(i), request_messages=None, compressed_messages=None, response_content=None))
    assert len(bounded.get_recent(RequestLogger.MAX_LOG_ENTRIES+1)) == RequestLogger.MAX_LOG_ENTRIES
    assert bounded.get_recent(RequestLogger.MAX_LOG_ENTRIES)[0]['request_id'] == '1'
    results.append({'case':'memory retention bound','result':'oldest of 10001 entries evicted; no durable gap marker in logger'})

    full = RequestLogger(str(Path(temp) / 'full.jsonl'), log_full_messages=True)
    full.log(entry())
    assert json.loads((Path(temp) / 'full.jsonl').read_text())['request_messages']
    results.append({'case':'opt-in full JSONL','result':'payload persisted'})
load('headroom.offline', 'headroom/offline.py')
beacon = load('headroom.telemetry.beacon', 'headroom/telemetry/beacon.py')
with patch.dict(os.environ, {}, clear=True):
    assert beacon.is_beacon_enabled() is True
    assert beacon.is_telemetry_enabled() is False
    os.environ['HEADROOM_TELEMETRY'] = 'off'
    assert beacon.is_beacon_enabled() is True
    os.environ['HEADROOM_BEACON'] = 'off'
    assert beacon.is_beacon_enabled() is False
results.append({'case':'telemetry policy predicates','result':'local telemetry defaults off; upload beacon defaults on and remains on with TELEMETRY=off; BEACON=off disables it; no upload executed'})
print(json.dumps({'pin':PIN,'scope':'isolated actual logger plus extracted exact dataclass; not integration validation','results':results},indent=2))
