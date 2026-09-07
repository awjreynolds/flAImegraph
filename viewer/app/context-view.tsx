'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type {
  ContextReport,
  HarnessFact,
  ContextOrigin,
} from '@/lib/context-types';
import { validateContextReport } from '@/lib/validator.js';
import realDemo from './demo.json';
import lifecycleDemo from './lifecycle.json';

const words = (text: string) => text.replaceAll('_', ' ');
const integer = (value: string) => BigInt(value);
function money(value: string | null | undefined, currency = 'USD') {
  if (value == null) return 'Unknown';
  const n = BigInt(value),
    abs = n < 0n ? -n : n,
    fraction = (abs % 1000000000n)
      .toString()
      .padStart(9, '0')
      .replace(/0+$/, '');
  return `${n < 0n ? '-' : ''}${currency === 'USD' ? '$' : currency + ' '}${abs / 1000000000n}${fraction ? '.' + fraction : '.00'}`;
}
const colors: Record<ContextOrigin, string> = {
  system_instruction: '#96aac2',
  developer_instruction: '#96aac2',
  user_prompt: '#e7c066',
  repository_instruction: '#9bb6ed',
  skill: '#bf9aeb',
  repository_file: '#57b9d2',
  retrieved_document: '#5aa9c5',
  tool_result: '#80c998',
  tool_schema: '#67aab5',
  output_schema: '#739aae',
  conversation_history: '#d492c1',
  assistant_output: '#b3a6d9',
  memory: '#a6b493',
  delegated_context: '#dc9e71',
  attachment: '#bfa080',
  unknown: '#8997a6',
};
const firstCall = (report: ContextReport) =>
  report.evidence.observations.find(
    (o) => o.kind === 'model' && o.accounting_scope === 'direct',
  )?.id ?? null;
const chooseRequest = (report: ContextReport, observation: string | null) => {
  const matches = report.context.requests.filter(
    (r) => r.observation_id === observation,
  );
  return (
    (matches.find((r) => r.boundary === 'client_request') ?? matches[0])?.id ??
    null
  );
};
const readFact = (fact: HarnessFact) =>
  `${fact.value === null ? 'Unknown' : String(fact.value)} · ${fact.evidence}`;
const refsText = (refs: Array<{ source_id: string; record: string }>) =>
  refs.map((r) => `${r.source_id} · ${r.record}`).join('\n') ||
  'No artifact reference';

type ModelTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelRegistry = {
  registerTool: (
    tool: ModelTool,
    options?: { signal: AbortSignal },
  ) => void | Promise<void>;
};

export default function Home() {
  const [report, setReport] = useState<ContextReport>(() =>
    validateContextReport(realDemo),
  );
  const [demoKind, setDemoKind] = useState<'real' | 'synthetic' | 'local'>(
    'real',
  );
  const [label, setLabel] = useState('Research capture');
  const [selected, setSelected] = useState<string | null>(() =>
    firstCall(report),
  );
  const [requestId, setRequestId] = useState<string | null>(() =>
    chooseRequest(report, selected),
  );
  const [search, setSearch] = useState('');
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('context');
  const inputRef = useRef<HTMLInputElement>(null);
  const calls = useMemo(
    () =>
      report.evidence.observations
        .filter((o) => o.kind === 'model' && o.accounting_scope === 'direct')
        .sort(
          (a, b) =>
            (a.timestamp ?? '~').localeCompare(b.timestamp ?? '~') ||
            a.id.localeCompare(b.id),
        ),
    [report],
  );
  const values = useMemo(
    () =>
      new Map(report.valuation.observations.map((o) => [o.observation_id, o])),
    [report],
  );
  const current = calls.find((o) => o.id === selected);
  const request = report.context.requests.find((r) => r.id === requestId);
  const profile = report.context.profiles.find(
    (p) => p.id === request?.profile_id,
  );
  const revisions = new Map(report.context.revisions.map((r) => [r.id, r]));
  const sources = new Map(report.context.sources.map((s) => [s.id, s]));
  const currentRows = (request?.occurrences ?? []).map((occurrence, index) => ({
    occurrence,
    index,
    revision: revisions.get(occurrence.revision_id)!,
  }));
  const detailRevision = revisionId ? revisions.get(revisionId) : undefined;
  const detailSource = detailRevision
    ? sources.get(detailRevision.source_id)
    : undefined;
  const allocation = report.allocations.find(
    (a) => a.request_id === request?.id,
  );
  const filtered = calls.filter((o) =>
    `${o.id} ${o.agent_id ?? ''} ${o.model ?? ''} ${o.operation}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const tokenKnown = currentRows.filter(
    (row) =>
      row.revision.tokens.value !== null &&
      row.revision.tokens.evidence !== 'counterfactual',
  );
  const knownTokens = tokenKnown.reduce(
    (sum, row) => sum + BigInt(row.revision.tokens.value!),
    0n,
  );
  const inputTokens =
    current?.usage?.input_tokens == null
      ? null
      : integer(current.usage.input_tokens);
  const weightTotal =
    inputTokens !== null && inputTokens >= knownTokens
      ? inputTokens
      : knownTokens;
  const share = (value: bigint) =>
    weightTotal > 0n ? Number((value * 10000n) / weightTotal) / 100 : 0;
  const selectCall = (id: string) => {
    setSelected(id);
    setRequestId(chooseRequest(report, id));
    setRevisionId(null);
  };
  const load = (
    value: unknown,
    kind: 'real' | 'synthetic' | 'local',
    name: string,
  ) => {
    const next = validateContextReport(value);
    setReport(next);
    setDemoKind(kind);
    setLabel(name);
    const first = firstCall(next);
    setSelected(first);
    setRequestId(chooseRequest(next, first));
    setSearch('');
    setRevisionId(null);
    setError('');
    setActiveTab('context');
  };
  async function readLocal(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error('Choose a report smaller than 20 MB.');
      load(JSON.parse(await file.text()), 'local', file.name);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to read this report.',
      );
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }
  useEffect(() => {
    const registry = (document as Document & { modelContext?: ModelRegistry })
      .modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: ModelTool) => {
      try {
        void Promise.resolve(
          registry.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser integration; visible controls remain available. */
      }
    };
    register({
      name: 'get_context_report_state',
      title: 'Read report state',
      description:
        'Read the loaded report summary and current request selection.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error('Expected an empty object');
        return {
          dataset_id: report.dataset_id,
          summary: report.summary,
          selected_observation_id: selected,
          selected_request_id: requestId,
        };
      },
    });
    register({
      name: 'select_context_request',
      title: 'Inspect a request',
      description:
        'Select an existing request context and show its context detail panel.',
      inputSchema: {
        type: 'object',
        properties: { request_id: { type: 'string' } },
        required: ['request_id'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute(input) {
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          !('request_id' in input) ||
          typeof input.request_id !== 'string'
        )
          throw new Error('Expected request_id');
        const target = report.context.requests.find(
          (r) => r.id === input.request_id,
        );
        if (!target) throw new Error('Unknown request_id');
        flushSync(() => {
          setSelected(target.observation_id);
          setRequestId(target.id);
          setActiveTab('context');
          setRevisionId(null);
        });
        return {
          request_id: target.id,
          observation_id: target.observation_id,
          boundary: target.boundary,
          coverage: target.coverage,
          occurrences: target.occurrences.length,
        };
      },
    });
    return () => lifecycle.abort();
  }, [report, selected, requestId]);

  return (
    <main>
      <header>
        <div className="brand">
          <span className="flame" aria-hidden="true">
            ▥
          </span>
          <strong>flAImegraph</strong>
          <span className="muted">/ Context explorer</span>
        </div>
        <div className="actions">
          <Link href="/operations/">Operation explorer →</Link>
          <span className="badge">Experimental 0.2</span>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            Open report
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            aria-label="Open local report JSON"
            onChange={(e) => void readLocal(e.target.files?.[0])}
          />
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">
            {demoKind === 'real'
              ? 'REAL WORK · CODEX · 4 AGENTS'
              : demoKind === 'synthetic'
                ? 'SYNTHETIC · CONTEXT LIFECYCLE'
                : 'LOCAL REPORT · VALIDATED'}
          </p>
          <h1>{label}</h1>
          <p className="muted">
            {demoKind === 'synthetic'
              ? 'Illustrative sources, token weights and costs. No provider calls.'
              : 'Request cost, context coverage and provenance in one place.'}
          </p>
        </div>
        <div className="actions">
          <Button
            variant={demoKind === 'real' ? 'secondary' : 'ghost'}
            onClick={() => load(realDemo, 'real', 'Research capture')}
          >
            Real capture
          </Button>
          <Button
            variant={demoKind === 'synthetic' ? 'secondary' : 'ghost'}
            onClick={() =>
              load(lifecycleDemo, 'synthetic', 'Context lifecycle')
            }
          >
            Lifecycle fixture
          </Button>
        </div>
      </section>
      {error && (
        <p role="alert" className="error">
          Report not loaded: {error}
        </p>
      )}
      <section className="metrics">
        <div>
          <span className="metric-label">
            Known cost · {words(report.valuation.basis)}
          </span>
          <strong className="amber">
            {money(report.summary.known_cost_nanos, report.valuation.currency)}
          </strong>
          <small>
            {report.summary.valuation_complete
              ? 'Complete selected valuation'
              : 'Partial valuation'}
          </small>
        </div>
        <div>
          <span className="metric-label">Model requests</span>
          <strong>{calls.length}</strong>
          <small>{report.context.requests.length} context manifests</small>
        </div>
        <div>
          <span className="metric-label">Context coverage</span>
          <strong>
            {report.summary.complete_context_requests} <small>complete</small>
          </strong>
          <small>
            {report.summary.partial_context_requests} partial ·{' '}
            {report.summary.unknown_context_requests} unknown
          </small>
        </div>
        <div>
          <span className="metric-label">Context sources</span>
          <strong>{report.summary.context_sources}</strong>
          <small>{report.context.transformations.length} transformations</small>
        </div>
      </section>
      <div className="workspace">
        <section className="requests">
          <div className="section-head">
            <h2>Request timeline</h2>
            <span className="muted">
              {report.valuation.currency} per request
            </span>
          </div>
          <Input
            aria-label="Search requests"
            placeholder="Search agent, model or request…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="request-list">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request / agent</TableHead>
                  <TableHead>Input tokens</TableHead>
                  <TableHead>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id} data-selected={selected === o.id}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        className="request-button"
                        onClick={() => selectCall(o.id)}
                        aria-pressed={selected === o.id}
                      >
                        <span className="ordinal">
                          {String(calls.indexOf(o) + 1).padStart(3, '0')}
                        </span>
                        {o.agent_id ?? o.operation}
                      </Button>
                      <small>{o.timestamp ?? 'Time unavailable'}</small>
                    </TableCell>
                    <TableCell>{o.usage?.input_tokens ?? 'Unknown'}</TableCell>
                    <TableCell className="amount">
                      {money(
                        values.get(o.id)?.amount_nanos,
                        report.valuation.currency,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filtered.length && (
              <p className="empty">
                {calls.length
                  ? 'No requests match this search.'
                  : 'This report contains no direct model requests.'}
              </p>
            )}
          </div>
        </section>
        <section className="detail">
          <div className="section-head">
            <h2>Request detail</h2>
            <span className="badge">
              {request ? words(request.coverage) : 'No manifest'}
            </span>
          </div>
          <div className="cost-title">
            <span>
              {current?.agent_id ?? current?.operation ?? 'Select a request'}
            </span>
            <strong className="amber">
              {money(
                values.get(selected ?? '')?.amount_nanos,
                report.valuation.currency,
              )}
            </strong>
          </div>
          <p className="muted">{current?.model ?? 'Model unknown'}</p>
          <p className="request-id">{selected}</p>
          {report.context.requests.filter((r) => r.observation_id === selected)
            .length > 1 && (
            <div className="boundary-picker">
              <label htmlFor="boundary-choice">Context boundary</label>
              <Select
                value={requestId}
                onValueChange={(value) => setRequestId(value)}
              >
                <SelectTrigger
                  id="boundary-choice"
                  aria-label="Choose captured context boundary"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {report.context.requests
                    .filter((r) => r.observation_id === selected)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {words(r.boundary)} · {r.id}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(String(value))}
            className="detail-tabs"
          >
            <TabsList variant="line">
              <TabsTrigger value="context">Context</TabsTrigger>
              <TabsTrigger value="profile">Harness profile</TabsTrigger>
              <TabsTrigger value="cost">Cost & coverage</TabsTrigger>
            </TabsList>
            <TabsContent value="context">
              {!request || request.boundary === 'unavailable' ? (
                <div className="coverage">
                  <h3>Final request not captured</h3>
                  <p>
                    Accounting telemetry does not identify the instructions,
                    files, skills or history assembled into this request.
                  </p>
                </div>
              ) : (
                <>
                  <p className="boundary-note">
                    {words(request.boundary)} · {request.coverage} coverage ·{' '}
                    {request.coverage_evidence}
                  </p>
                  {knownTokens > 0n ? (
                    <>
                      <div
                        className="composition"
                        aria-label="Input context composition"
                      >
                        {tokenKnown.map(({ occurrence, revision }) => (
                          <button
                            key={occurrence.id}
                            style={{
                              width: `${share(BigInt(revision.tokens.value!))}%`,
                              background:
                                colors[sources.get(revision.source_id)!.origin],
                            }}
                            title={`${sources.get(revision.source_id)!.label}: ${revision.tokens.value} ${revision.tokens.evidence} tokens`}
                            aria-label={`Inspect ${sources.get(revision.source_id)!.label}`}
                            onClick={() => setRevisionId(revision.id)}
                          />
                        ))}
                        {inputTokens !== null && inputTokens > knownTokens && (
                          <span
                            className="uncovered"
                            style={{
                              width: `${share(inputTokens - knownTokens)}%`,
                            }}
                            title={`${inputTokens - knownTokens} tokens not assigned to captured sources`}
                          />
                        )}
                      </div>
                      <p className="composition-caption">
                        {knownTokens.toString()} captured token weight /{' '}
                        {inputTokens?.toString() ?? 'unknown'} observed input
                        tokens
                      </p>
                      {inputTokens !== null && knownTokens > inputTokens && (
                        <p className="error">
                          Captured weights exceed input usage; allocation is
                          unavailable.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="coverage compact">
                      Per-source token counts are unavailable. Captured bytes
                      are not treated as billed tokens.
                    </p>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ordered occurrence</TableHead>
                        <TableHead>Representation</TableHead>
                        <TableHead>Tokens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentRows.map(({ occurrence, revision, index }) => {
                        const source = sources.get(revision.source_id)!;
                        return (
                          <TableRow key={occurrence.id}>
                            <TableCell>
                              <Button
                                variant="ghost"
                                className="source-button"
                                onClick={() => setRevisionId(revision.id)}
                              >
                                <span
                                  className="source-dot"
                                  style={{ background: colors[source.origin] }}
                                />
                                {index + 1}. {source.label}
                              </Button>
                              <small>
                                {words(source.origin)} ·{' '}
                                {source.origin_evidence}
                              </small>
                            </TableCell>
                            <TableCell>
                              {revision.representation}
                              <small>{words(occurrence.placement)}</small>
                            </TableCell>
                            <TableCell>
                              {revision.tokens.value ?? 'Unknown'}
                              <small>{revision.tokens.evidence}</small>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  {!currentRows.length && (
                    <p className="empty">
                      No source occurrences were captured at this boundary.
                    </p>
                  )}
                </>
              )}
              <p className="note">
                Repeated appearances are separate occurrences. Summary tokens
                are not distributed back to the original sources.
              </p>
            </TabsContent>
            <TabsContent value="profile">
              {profile ? (
                <div className="profile-content">
                  <h3>{profile.name}</h3>
                  <dl>
                    <dt>Harness</dt>
                    <dd>{profile.harness}</dd>
                    <dt>Harness version</dt>
                    <dd>{readFact(profile.harness_version)}</dd>
                    <dt>Profile version</dt>
                    <dd>{profile.profile_version}</dd>
                    <dt>Model</dt>
                    <dd>{readFact(profile.model.name)}</dd>
                    <dt>Provider</dt>
                    <dd>{readFact(profile.model.provider)}</dd>
                    {Object.entries(profile.model.settings).map(
                      ([key, fact]) => (
                        <div className="dl-row" key={key}>
                          <dt>{key}</dt>
                          <dd>{readFact(fact)}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                  <h3>Context policies</h3>
                  <dl>
                    {Object.entries(profile.policies).map(([key, fact]) => (
                      <div className="dl-row" key={key}>
                        <dt>{words(key)}</dt>
                        <dd>{readFact(fact)}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3>Request overrides</h3>
                  {Object.keys(request?.overrides ?? {}).length ? (
                    <dl>
                      {Object.entries(request!.overrides).map(([key, fact]) => (
                        <div className="dl-row" key={key}>
                          <dt>{key}</dt>
                          <dd>{readFact(fact)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted">
                      No effective overrides were captured.
                    </p>
                  )}
                  <h3>Instructions & skills</h3>
                  {profile.instruction_sources.length ? (
                    profile.instruction_sources.map((instruction, i) => (
                      <p key={i}>
                        {instruction.label}
                        <small className="block">
                          {words(instruction.origin)} ·{' '}
                          {words(instruction.delivery)} · {instruction.evidence}
                        </small>
                      </p>
                    ))
                  ) : (
                    <p className="muted">Instruction sources unknown.</p>
                  )}
                  <h3>Tools</h3>
                  {profile.tools.length ? (
                    profile.tools.map((tool) => (
                      <p key={tool.id}>
                        {tool.name}
                        <small className="block">
                          {tool.evidence} · definition{' '}
                          {tool.definition_evidence}
                        </small>
                      </p>
                    ))
                  ) : (
                    <p className="muted">Tool definitions unknown.</p>
                  )}
                  <h3>Capture capabilities</h3>
                  {profile.context_capabilities.map((cap) => (
                    <p key={cap.origin}>
                      {words(cap.origin)}
                      <small className="block">
                        {cap.capture} · {cap.evidence} · {cap.note}
                      </small>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="empty">
                  No harness profile is linked to this observation.
                </p>
              )}
            </TabsContent>
            <TabsContent value="cost">
              <div className="profile-content">
                <dl>
                  <dt>Selected cost</dt>
                  <dd>
                    {money(
                      values.get(selected ?? '')?.amount_nanos,
                      report.valuation.currency,
                    )}
                  </dd>
                  <dt>Exact nanounits</dt>
                  <dd>
                    {values.get(selected ?? '')?.amount_nanos ?? 'Unknown'} nano
                    {report.valuation.currency}
                  </dd>
                  <dt>Cost basis</dt>
                  <dd>
                    {words(values.get(selected ?? '')?.basis ?? 'unknown')}
                  </dd>
                  <dt>Input tokens</dt>
                  <dd>{current?.usage?.input_tokens ?? 'Unknown'}</dd>
                  <dt>Output tokens</dt>
                  <dd>{current?.usage?.output_tokens ?? 'Unknown'}</dd>
                  <dt>Cache read tokens</dt>
                  <dd>
                    {current?.usage?.cache_read_input_tokens ?? 'Unknown'}
                  </dd>
                  <dt>Cache write tokens</dt>
                  <dd>
                    {current?.usage?.cache_write_input_tokens ?? 'Unknown'}
                  </dd>
                  <dt>Capture boundary</dt>
                  <dd>{words(request?.boundary ?? 'unavailable')}</dd>
                </dl>
                {allocation ? (
                  <section className="allocation">
                    <h3>Estimated context allocation</h3>
                    <p className="muted">
                      Whole request cost, including output. This is an estimated
                      distribution, not source billing or predicted savings.
                    </p>
                    <dl>
                      <dt>Allocated</dt>
                      <dd>
                        {money(
                          allocation.allocated_nanos,
                          report.valuation.currency,
                        )}
                      </dd>
                      <dt>Unallocated</dt>
                      <dd>
                        {money(
                          allocation.unallocated_nanos,
                          report.valuation.currency,
                        )}
                      </dd>
                      <dt>Input denominator</dt>
                      <dd>
                        {allocation.denominator_tokens ?? 'Unknown'} tokens
                      </dd>
                      <dt>Unallocated weight</dt>
                      <dd>
                        {allocation.unallocated_weight_tokens ?? 'Unknown'}{' '}
                        tokens
                      </dd>
                    </dl>
                    {allocation.portions.map((portion) => (
                      <p className="allocation-row" key={portion.occurrence_id}>
                        <span>
                          {sources.get(portion.source_id)?.label ??
                            portion.source_id}
                        </span>
                        <span>
                          {money(
                            portion.amount_nanos,
                            report.valuation.currency,
                          )}
                        </span>
                      </p>
                    ))}
                  </section>
                ) : (
                  <p className="coverage compact">
                    No context cost allocation was selected for this request.
                  </p>
                )}
                <h3>Source references</h3>
                <pre>
                  {refsText(request?.source_refs ?? current?.source_refs ?? [])}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
      <Tabs defaultValue="issues" className="lower-tabs">
        <TabsList variant="line">
          <TabsTrigger value="issues">Coverage notes</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          {demoKind === 'real' && (
            <TabsTrigger value="flamegraph">
              Standard cost flame graph
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="issues">
          <div className="issue-list">
            {[...report.valuation.issues, ...report.issues].map((issue, i) => (
              <p key={i}>
                <span className="badge">{issue.severity}</span> {issue.message}
              </p>
            ))}
            {!report.valuation.issues.length && !report.issues.length && (
              <p className="muted">
                No additional coverage issues were reported.
              </p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="activity">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.evidence.observations
                .filter((o) => o.kind !== 'model')
                .sort((a, b) =>
                  (a.timestamp ?? '~').localeCompare(b.timestamp ?? '~'),
                )
                .map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.timestamp ?? 'Unknown'}</TableCell>
                    <TableCell>{o.kind}</TableCell>
                    <TableCell>{o.operation}</TableCell>
                    <TableCell>{o.status}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {report.evidence.observations.every((o) => o.kind === 'model') && (
            <p className="empty">
              No separate tool or activity events were captured.
            </p>
          )}
        </TabsContent>
        {demoKind === 'real' && (
          <TabsContent value="flamegraph">
            <p className="graph-note">
              The standard FlameGraph view preserves the selected request costs.
              Click a frame to zoom; use its Search control to find a stack.
            </p>
            <object
              data="/research-cost.svg"
              type="image/svg+xml"
              className="standard-graph"
              aria-label="Standard research cost flame graph"
            >
              <a href="/research-cost.svg" download>
                Download the cost flame graph
              </a>
            </object>
          </TabsContent>
        )}
      </Tabs>
      <footer>
        Files opened here stay in this browser tab. No report is uploaded or
        stored. ·{' '}
        <a href="https://github.com/awjreynolds/flAImegraph">
          Open interchange & CLI
        </a>
      </footer>
      <Sheet
        open={revisionId !== null}
        onOpenChange={(open) => {
          if (!open) setRevisionId(null);
        }}
      >
        <SheetContent className="source-sheet">
          <SheetHeader>
            <SheetTitle>{detailSource?.label ?? 'Context source'}</SheetTitle>
            <SheetDescription>
              {detailSource
                ? `${words(detailSource.origin)} · ${detailSource.origin_evidence}`
                : 'Source provenance and reuse'}
            </SheetDescription>
          </SheetHeader>
          {detailRevision && detailSource && (
            <div className="sheet-body">
              <h3>Revision</h3>
              <dl>
                <dt>Representation</dt>
                <dd>{detailRevision.representation}</dd>
                <dt>Media</dt>
                <dd>{detailRevision.media}</dd>
                <dt>Tokens</dt>
                <dd>
                  {detailRevision.tokens.value ?? 'Unknown'} ·{' '}
                  {detailRevision.tokens.evidence}
                </dd>
                <dt>Token method</dt>
                <dd>{detailRevision.tokens.method}</dd>
                <dt>Bytes</dt>
                <dd>
                  {detailRevision.bytes.value ?? 'Unknown'} ·{' '}
                  {detailRevision.bytes.evidence}
                </dd>
                <dt>Byte method</dt>
                <dd>{detailRevision.bytes.method}</dd>
                <dt>Fingerprint</dt>
                <dd>{detailRevision.fingerprint_evidence}</dd>
              </dl>
              <pre>
                {detailRevision.content_sha256 ?? 'Fingerprint unavailable'}
              </pre>
              <h3>Occurrences across requests</h3>
              {report.context.requests.flatMap((r) =>
                r.occurrences
                  .filter(
                    (o) =>
                      revisions.get(o.revision_id)?.source_id ===
                      detailSource.id,
                  )
                  .map((o) => (
                    <p key={o.id}>
                      <Button
                        variant="link"
                        onClick={() => {
                          setSelected(r.observation_id);
                          setRequestId(r.id);
                          setRevisionId(null);
                          setActiveTab('context');
                        }}
                      >
                        {r.id}
                      </Button>
                      <small className="block">
                        {revisions.get(o.revision_id)?.representation} ·{' '}
                        {words(o.placement)} · treatment{' '}
                        {words(o.treatment.value)} ({o.treatment.evidence})
                      </small>
                    </p>
                  )),
              )}
              <h3>Transformations</h3>
              {report.context.transformations
                .filter(
                  (t) =>
                    t.from_revision_ids.includes(detailRevision.id) ||
                    t.to_revision_ids.includes(detailRevision.id),
                )
                .map((t) => (
                  <div className="transformation" key={t.id}>
                    <p>
                      <strong>{words(t.kind)}</strong> · {t.evidence}
                    </p>
                    <p className="muted">{t.method}</p>
                    <p>
                      {t.from_revision_ids
                        .map(
                          (id) =>
                            sources.get(revisions.get(id)!.source_id)!.label,
                        )
                        .join(' + ')}{' '}
                      →{' '}
                      {t.to_revision_ids
                        .map(
                          (id) =>
                            sources.get(revisions.get(id)!.source_id)!.label,
                        )
                        .join(' + ')}
                    </p>
                  </div>
                ))}
              {!report.context.transformations.some(
                (t) =>
                  t.from_revision_ids.includes(detailRevision.id) ||
                  t.to_revision_ids.includes(detailRevision.id),
              ) && (
                <p className="muted">
                  No captured transformation links this revision.
                </p>
              )}
              <h3>Provenance</h3>
              <pre>{refsText(detailRevision.source_refs)}</pre>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
