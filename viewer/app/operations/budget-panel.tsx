'use client';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createOperationBudget, validateRateCard } from '@/lib/validator.js';
import type { OperationReport } from '@/lib/operation-types';
import type { OperationBudgetCategory, OperationBudgetObservation } from '@/lib/operation-budget';
import type { RateCard } from '@/lib/types';
import nativeRates from '@/lib/enterprise-rate-scenario.json';

const integer = (value: string) => BigInt(value);

export function budgetMoney(value: string, currency: string) {
  const n = integer(value), a = n < 0n ? -n : n;
  const fraction = (a % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${n < 0n ? '-' : ''}${currency === 'USD' ? '$' : currency + ' '}${a / 1_000_000_000n}.${fraction}`;
}
const names = { input: 'Uncached input', cache_read: 'Cached input', cache_write: 'Cache writes', output: 'Output' };
const percentage = (part: bigint, total: bigint) => total > 0n ? Number(part * 10_000n / total) / 100 : 0;
type Group = { id: string; label: string; operation: string | null; rows: OperationBudgetObservation[]; amount: bigint; charges: bigint; unknown: number };

export function BudgetPanel({ report, operationId, onInspect, compact = false, rateCard, onRateCardChange }: { report: OperationReport; operationId?: string; onInspect: (id: string) => void; compact?: boolean; rateCard?: RateCard; onRateCardChange?: (value: RateCard) => void }) {
  const [suppliedRates, setSuppliedRates] = useState<RateCard | undefined>();
  const [rateError, setRateError] = useState('');
  const [scope, setScope] = useState<string | undefined>();
  const [groupBy, setGroupBy] = useState('activity');
  const [compare, setCompare] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const rateInput = useRef<HTMLInputElement>(null);
  const selectedScope = operationId ?? scope;
  const rates = rateCard ?? suppliedRates ?? (report.valuation.rate_card_id === nativeRates.id ? nativeRates as RateCard : undefined);
  const budget = useMemo(() => createOperationBudget(report, rates, selectedScope), [report, rates, selectedScope]);
  const spans = useMemo(() => new Map(report.operations.spans.map(span => [span.id, span])), [report]);
  const observations = useMemo(() => new Map(report.evidence.observations.map(row => [row.id, row])), [report]);
  const paths = useMemo(() => new Map(report.execution_cost.map(row => [row.observation_id, row.operation_ids])), [report]);
  const groups = useMemo(() => {
    const result = new Map<string, Group>();
    for (const row of budget.observations) {
      const observation = observations.get(row.observation_id);
      const operation = row.operation_id ? spans.get(row.operation_id) : undefined;
      let path = paths.get(row.observation_id);
      if (!path && operation) { path = []; let current: typeof operation | undefined = operation; while (current) { path.unshift(current.id); current = current.parent_id ? spans.get(current.parent_id) : undefined; } }
      const scopeIndex = selectedScope ? path?.indexOf(selectedScope) ?? -1 : -1;
      const childId = path?.[scopeIndex + 1] ?? operation?.id;
      const child = childId ? spans.get(childId) : undefined;
      const label = groupBy === 'model' ? observation?.model ?? 'Unknown model' : groupBy === 'agent' ? operation?.agent_id ?? observation?.agent_id ?? 'Agent not recorded' : child?.label ?? 'Cost without an operation link';
      const id = groupBy === 'activity' ? child?.id ?? 'unbound' : label;
      let group = result.get(id);
      if (!group) { group = { id, label, operation: groupBy === 'activity' ? child?.id ?? null : null, rows: [], amount: 0n, charges: 0n, unknown: 0 }; result.set(id, group); }
      group.rows.push(row);
      const amount = integer(row.amount_nanos ?? '0');
      group.amount += amount; if (amount > 0n) group.charges += amount;
      if (row.amount_nanos === null) group.unknown++;
    }
    return [...result.values()].sort((a, b) => a.charges > b.charges ? -1 : a.charges < b.charges ? 1 : a.label.localeCompare(b.label));
  }, [budget, observations, spans, paths, selectedScope, groupBy]);
  const selectedGroups = groups.filter(group => compare.includes(group.id));
  const visibleGroups = groups.filter(group => !query.trim() || `${group.label} ${group.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const totalCharges = integer(budget.charges_nanos);
  const money = (value: string | bigint) => budgetMoney(value.toString(), budget.currency);
  const categoryAmount = (category: OperationBudgetCategory) => category.amount_nanos === '0' && category.unpriced_observations ? 'Unknown' : `${money(category.amount_nanos)}${category.unpriced_observations ? ' + unknown' : ''}`;
  const pricedTokens = (category: OperationBudgetCategory) => budget.observations.reduce((sum, row) => { const part = row.categories.find(item => item.category === category.category)!; return sum + (part.unpriced_observations ? 0n : integer(part.tokens)); }, 0n);
  async function openRates(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Choose a rate card smaller than 1 MB.');
      const value = validateRateCard(JSON.parse(await file.text()));
      if (value.id !== report.valuation.rate_card_id) throw new Error('This rate card does not match the selected valuation. Load the rate card used to price this report.');
      setSuppliedRates(value); onRateCardChange?.(value); setRateError('');
    } catch (error) { setRateError(error instanceof Error ? error.message : 'Unable to load rate card.'); }
    finally { if (rateInput.current) rateInput.current.value = ''; }
  }
  return <section className="budget-panel" aria-label={compact ? 'Selected operation dollar costs' : 'Dollar and token cost analysis'}>
    <div className="budget-heading"><div><p className="eyebrow">{selectedScope ? 'SELECTED ACTIVITY · INCLUDING CHILDREN' : 'WHOLE RUN · SELECTED PRICING'}</p><h2>{compact ? selectedScope ? 'Cost of this activity' : 'Token-cost breakdown' : 'Where the dollars go'}</h2><p>{selectedScope ? spans.get(selectedScope)?.label : 'Compare activities and the price of each token category.'}</p></div><div className="budget-total"><strong>{money(budget.known_total_nanos)}</strong><span>{budget.unknown_observation_count ? `Known subtotal · ${budget.unknown_observation_count} observations unpriced` : 'Selected cost'}</span></div></div>
    <div className="budget-categories">{budget.categories.map(category => <div key={category.category} className={`budget-category category-${category.category}`}><span>{names[category.category]}</span><strong>{categoryAmount(category)}</strong><small>{pricedTokens(category).toLocaleString()} priced tokens{integer(category.tokens) > pricedTokens(category) ? ` · ${(integer(category.tokens) - pricedTokens(category)).toLocaleString()} unpriced tokens` : ''}{category.unknown_token_observations ? ` · ${category.unknown_token_observations} unknown counts` : ''}</small><div className="budget-track" aria-hidden="true"><span style={{ width: `${percentage(integer(category.amount_nanos) > 0n ? integer(category.amount_nanos) : 0n, totalCharges)}%` }} /></div></div>)}</div>
    <p className="budget-explainer">Token counts include unpriced observations. Uncached input excludes cache reads and writes. Output includes reasoning tokens; they are not charged twice. Dollar splits are calculated from supplied rates and reconciled to the selected total.</p>
    {(budget.unattributed_amount_nanos !== '0' || budget.rounding_adjustment_nanos !== '0' || budget.credits_nanos !== '0') && <div className="budget-reconciliation">{budget.unattributed_amount_nanos !== '0' && <p><strong>{money(budget.unattributed_amount_nanos)}</strong> has no available token-category split.</p>}{budget.rounding_adjustment_nanos !== '0' && <p>{money(budget.rounding_adjustment_nanos)} rounding adjustment preserves the exact total.</p>}{budget.credits_nanos !== '0' && <p>{money(budget.charges_nanos)} charges − {money(budget.credits_nanos)} credits = {money(budget.known_total_nanos)} net.</p>}</div>}
    {!compact && <>
      <div className="budget-rate"><span>{rates ? `Supplied rate scenario: ${rates.id}` : 'Token prices are unavailable in this report.'}</span><Button variant="outline" onClick={() => rateInput.current?.click()}>Load matching rate card</Button><input className="sr-only" ref={rateInput} type="file" accept=".json,application/json" aria-label="Load matching token rate card" onChange={event => void openRates(event.target.files?.[0])} /></div>
      {rateError && <p className="op-error" role="alert">{rateError}</p>}
      {rates && <details className="budget-rates"><summary>Inspect the declared token prices</summary><p>{rates.basis.replaceAll('_', ' ')} · retrieved {rates.retrieved_at.slice(0, 10)}. These are the report’s saved scenario rates, not a live price quote.</p>{rates.rules.map(rule => <div key={rule.id}><strong>{rule.model}</strong><p>{Object.entries(rule.rates).map(([category, rate]) => `${names[category as keyof typeof names]}: ${rate === null ? 'unknown' : `${rates.currency === 'USD' ? '$' : rates.currency + ' '}${rate}`} per ${integer(rule.unit_tokens).toLocaleString()} tokens`).join(' · ')}</p></div>)}</details>}
      <div className="budget-comparison-heading"><h3>Compare cost</h3><label>Group by <select aria-label="Group cost comparison" value={groupBy} onChange={event => { setGroupBy(event.target.value); setCompare([]); setQuery(''); }}><option value="activity">Activity</option><option value="model">Model</option><option value="agent">Agent</option></select></label>{selectedScope && <Button variant="outline" onClick={() => { setScope(undefined); setCompare([]); setQuery(''); }}>Whole run</Button>}</div>
      {selectedGroups.length === 2 && <div className="budget-compare-result"><strong>{selectedGroups[0].label}</strong> {money(selectedGroups[0].amount)} · <strong>{selectedGroups[1].label}</strong> {money(selectedGroups[1].amount)}<p>Known cost difference: <strong>{money(selectedGroups[0].amount - selectedGroups[1].amount)}</strong>. {selectedGroups.some(group => group.unknown) ? 'Unpriced observations are excluded.' : ''} This comparison does not establish equal outcomes or causal savings.</p><div className="budget-compare-categories">{budget.categories.map(category => { const sums = selectedGroups.map(group => group.rows.reduce((sum, row) => sum + integer(row.categories.find(item => item.category === category.category)!.amount_nanos), 0n)); return <p key={category.category}>{names[category.category]}: {money(sums[0])}{selectedGroups[0].rows.some(row => row.categories.find(item => item.category === category.category)!.unpriced_observations) ? ' + unknown' : ''} vs {money(sums[1])}{selectedGroups[1].rows.some(row => row.categories.find(item => item.category === category.category)!.unpriced_observations) ? ' + unknown' : ''}</p>; })}</div></div>}
      <p className="budget-explainer">Select two rows to compare. Bars show known positive cost; each row includes its children once.</p>
      <input className="budget-search" aria-label="Search cost comparison" placeholder="Find an activity, model or agent…" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="budget-groups">{visibleGroups.slice(0, 30).map((group, index) => <div className="budget-group" key={group.id}><label><input type="checkbox" aria-label={`Compare ${group.label} ${index + 1}`} checked={compare.includes(group.id)} onChange={event => setCompare(event.target.checked ? [...compare.slice(-1), group.id] : compare.filter(id => id !== group.id))} /><span>{group.label}<small>{group.operation ? `Capture event ${spans.get(group.operation)?.sequence} · ` : ''}{group.rows.length} model/cost observations{group.unknown ? ` · ${group.unknown} unpriced` : ''}</small></span></label><strong>{money(group.amount)}{group.unknown ? ' + unknown' : ''}</strong><div className="budget-track" aria-hidden="true"><span style={{ width: `${percentage(group.charges, totalCharges)}%` }} /></div>{group.operation && <div className="budget-group-actions"><Button variant="ghost" size="sm" onClick={() => onInspect(group.operation!)}>Cost details</Button>{report.nodes.find(node => node.operation_id === group.operation)?.child_count ? <Button variant="outline" size="sm" onClick={() => { setScope(group.operation!); setCompare([]); setQuery(''); }}>Break down activity</Button> : null}</div>}</div>)}</div>
      {visibleGroups.length > 30 && <p className="budget-explainer">Showing the 30 highest-cost matches of {visibleGroups.length}. Refine the search or use the execution tree to inspect any operation.</p>}
      {groups.length === 0 && <p>No direct model cost observations are available for this scope.</p>}
    </>}
    {budget.notes.length > 0 && <details className="budget-rates"><summary>Cost breakdown assumptions and limits</summary>{budget.notes.map((note, index) => <p key={index}>{note}</p>)}</details>}
  </section>;
}
