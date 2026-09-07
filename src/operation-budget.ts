import { validateRateCard } from "./core.js";
import { OperationError, validateOperationReport } from "./operations.js";
import type { OperationReport } from "./operation-types.js";
import type { Observation, RateCard, RateRule, Usage, Valuation } from "./types.js";

const CATEGORIES = ["input", "cache_read", "cache_write", "output"] as const;
const NANO_SCALE = 1_000_000_000n;
type Category = typeof CATEGORIES[number];

export interface OperationBudgetCategory {
  category: Category;
  /** Known token total; cache counts are disjoint subsets of inclusive input. */
  tokens: string;
  unknown_token_observations: number;
  /** Signed known monetary subtotal for this category. */
  amount_nanos: string;
  unpriced_observations: number;
}

export interface OperationBudgetObservation {
  observation_id: string;
  operation_id: string | null;
  /** The selected valuation line. Null remains an unknown amount. */
  amount_nanos: string | null;
  categories: OperationBudgetCategory[];
  /** Signed known amount which could not be split into component categories. */
  unattributed_amount_nanos: string;
  /** Signed residual after independently rounding accepted category amounts. */
  rounding_adjustment_nanos: string;
  unknown_token_observations: number;
  unpriced_observations: number;
  notes: string[];
}

export interface OperationBudget {
  dataset_id: string;
  currency: string;
  basis: Valuation["basis"];
  rate_card_id?: string;
  operation_id: string | null;
  scope: "whole_run" | "subtree";
  /** Sum of known selected valuation lines, including signed credits. */
  known_total_nanos: string;
  charges_nanos: string;
  credits_nanos: string;
  categories: OperationBudgetCategory[];
  unattributed_amount_nanos: string;
  rounding_adjustment_nanos: string;
  unknown_observation_count: number;
  scope_observation_ids: string[];
  unknown_cost_observation_ids: string[];
  observations: OperationBudgetObservation[];
  notes: string[];
}

interface Rational { numerator: bigint; denominator: bigint }
type TokenQuantity = bigint | null;
interface TokenParts { input: TokenQuantity; cache_read: TokenQuantity; cache_write: TokenQuantity; output: TokenQuantity }
interface UsageAnalysis { parts: TokenParts; canSplit: boolean; reasons: string[] }

function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const doubled = remainder * 2n;
  let rounded = quotient;
  if (doubled > denominator || (doubled === denominator && quotient % 2n === 1n)) rounded += 1n;
  return negative ? -rounded : rounded;
}

function decimal(value: string): Rational {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}` || "0");
  return { numerator: negative ? -numerator : numerator, denominator: scale };
}

function productOf(observation: Observation): string | undefined {
  if (observation.product !== undefined) return observation.product;
  const product = observation.attributes?.product;
  return typeof product === "string" ? product : undefined;
}

function rateMatches(observation: Observation, rule: RateRule): boolean {
  if (observation.model === undefined || observation.model_identity === "unknown" || observation.model !== rule.model) return false;
  if (rule.provider !== undefined && observation.provider !== rule.provider) return false;
  if (rule.product !== undefined && productOf(observation) !== rule.product) return false;
  return intervalMatches(observation, rule);
}

function intervalMatches(observation: Observation, rule: RateRule): boolean {
  const from = rule.valid_from ? Date.parse(rule.valid_from) : undefined;
  const to = rule.valid_to ? Date.parse(rule.valid_to) : undefined;
  if (from === undefined && to === undefined) return true;
  if (observation.timestamp === undefined) return false;
  const timestamp = Date.parse(observation.timestamp);
  return (from === undefined || timestamp >= from) && (to === undefined || timestamp < to);
}

function uniqueRule(observation: Observation, card: RateCard): { rule?: RateRule; reason?: string } {
  if (observation.model === undefined || observation.model_identity === "unknown") return { reason: "model identity is unavailable or explicitly unknown" };
  const product = productOf(observation);
  const potential = card.rules.filter(rule => {
    if (rule.model !== observation.model) return false;
    if (observation.provider !== undefined && rule.provider !== undefined && rule.provider !== observation.provider) return false;
    if (product !== undefined && rule.product !== undefined && rule.product !== product) return false;
    return true;
  });
  const datedPotential = observation.timestamp === undefined ? potential : potential.filter(rule => intervalMatches(observation, rule));
  if (observation.provider === undefined && datedPotential.some(rule => rule.provider !== undefined)) return { reason: "provider is unavailable while provider-specific rates exist" };
  if (product === undefined && datedPotential.some(rule => rule.product !== undefined)) return { reason: "product is unavailable while product-specific rates exist" };
  if (observation.timestamp === undefined && potential.some(rule => rule.valid_from != null || rule.valid_to != null)) return { reason: "observation timestamp is required for dated rates" };
  const candidates = card.rules.filter(rule => rateMatches(observation, rule));
  if (candidates.length === 0) return { reason: "no rate rule uniquely matches model, provider, product and date" };
  if (candidates.length > 1) return { reason: "more than one rate rule matches the observation" };
  return { rule: candidates[0] };
}

function usageParts(observation: Observation): UsageAnalysis {
  const unknown: TokenParts = { input: null, cache_read: null, cache_write: null, output: null };
  if (observation.kind !== "model") return { parts: unknown, canSplit: false, reasons: ["token evidence is limited to model observations"] };
  const usage: Usage | null = observation.usage;
  if (usage === null) return { parts: unknown, canSplit: false, reasons: ["usage is unavailable"] };
  const input = usage.input_tokens === null ? null : BigInt(usage.input_tokens);
  const cacheRead = usage.cache_read_input_tokens === null ? null : BigInt(usage.cache_read_input_tokens);
  const cacheWrite = usage.cache_write_input_tokens === null ? null : BigInt(usage.cache_write_input_tokens);
  const output = usage.output_tokens === null ? null : BigInt(usage.output_tokens);
  const reasons: string[] = [];
  let fresh: bigint | null = null;
  if (input !== null && cacheRead !== null && cacheWrite !== null) {
    if (cacheRead + cacheWrite <= input) fresh = input - cacheRead - cacheWrite;
    else reasons.push("cache subsets exceed inclusive input");
  }
  if (input === null || cacheRead === null || cacheWrite === null || output === null) reasons.push("some declared token categories are unavailable");
  if (usage.unclassified_tokens === null) reasons.push("unclassified token coverage is incomplete");
  else if (usage.unclassified_tokens !== undefined && BigInt(usage.unclassified_tokens) > 0n) reasons.push("unclassified token coverage is incomplete");
  if (usage.unclassified_tokens === undefined) reasons.push("unclassified token category was not reported");
  return { parts: { input: fresh, cache_read: cacheRead, cache_write: cacheWrite, output }, canSplit: fresh !== null && output !== null && usage.unclassified_tokens !== null && (usage.unclassified_tokens === undefined || BigInt(usage.unclassified_tokens) === 0n), reasons };
}

function exactCategoryAmounts(rule: RateRule, parts: TokenParts): { rounded: Record<Category, bigint>; combined: bigint } | undefined {
  if (CATEGORIES.some(category => parts[category] === null)) return undefined;
  const values = CATEGORIES.map(category => {
    const rate = rule.rates[category];
    const tokens = parts[category]!;
    if (tokens > 0n && rate === null) return undefined;
    return { category, tokens, rate: rate === null ? undefined : decimal(rate) };
  });
  if (values.some(value => value === undefined)) return undefined;
  const present = values as Array<{ category: Category; tokens: bigint; rate: Rational | undefined }>;
  const scale = present.reduce((maximum, item) => Math.max(maximum, item.rate?.denominator.toString().length ?? 1), 1);
  // Rates are decimal rationals. Normalize by decimal places rather than by
  // denominator digits, which also handles rate "0" without floating point.
  const normalized = present.map(item => {
    const rate = item.rate;
    if (!rate) return { ...item, numerator: 0n };
    const places = rate.denominator.toString().length - 1;
    return { ...item, numerator: rate.numerator * 10n ** BigInt(scale - places) };
  });
  const denominator = BigInt(rule.unit_tokens) * 10n ** BigInt(scale);
  const numerator = normalized.reduce((sum, item) => sum + item.tokens * item.numerator, 0n);
  const rounded: Record<Category, bigint> = { input: 0n, cache_read: 0n, cache_write: 0n, output: 0n };
  for (const item of normalized) rounded[item.category] = roundHalfEven(item.tokens * item.numerator * NANO_SCALE, denominator);
  return { rounded, combined: roundHalfEven(numerator * NANO_SCALE, denominator) };
}

function emptyCategory(category: Category): OperationBudgetCategory {
  return { category, tokens: "0", unknown_token_observations: 0, amount_nanos: "0", unpriced_observations: 0 };
}

function signed(value: bigint, sign: bigint): bigint { return value * sign; }

/**
 * Project selected valued observations into token categories and exact money.
 * This is an analysis projection: supplied rates are checked against the
 * embedded valuation but are not a proof of the provider's billed breakdown.
 */
export function createOperationBudget(input: OperationReport, suppliedRateCard?: RateCard, operationId?: string): OperationBudget {
  const report = validateOperationReport(input);
  const rateCard = suppliedRateCard === undefined ? undefined : validateRateCard(suppliedRateCard);
  const spans = new Map(report.operations.spans.map(span => [span.id, span]));
  if (operationId !== undefined && !spans.has(operationId)) throw new OperationError("OPERATION_BUDGET_SCOPE", `Unknown operation ${operationId}`);
  const paths = new Map<string, string[]>();
  for (const span of report.operations.spans) {
    const path: string[] = [];
    let current: typeof span | undefined = span;
    while (current) { path.unshift(current.id); current = current.parent_id === null ? undefined : spans.get(current.parent_id); }
    paths.set(span.id, path);
  }
  const operationByObservation = new Map<string, string>();
  for (const span of report.operations.spans) if (span.observation_id !== null) operationByObservation.set(span.observation_id, span.id);
  const evidenceById = new Map(report.evidence.observations.map(observation => [observation.id, observation]));
  const direct = new Set(report.evidence.observations.filter(observation => observation.accounting_scope === "direct").map(observation => observation.id));
  const selected = report.valuation.observations.filter(line => {
    if (!direct.has(line.observation_id)) return false;
    if (operationId === undefined) return true;
    const operation = operationByObservation.get(line.observation_id);
    return operation !== undefined && paths.get(operation)!.includes(operationId);
  });
  const selectedIds = selected.map(line => line.observation_id);
  const categories = CATEGORIES.map(emptyCategory);
  const notes = new Set<string>();
  const reportCardMatches = rateCard !== undefined && report.valuation.rate_card_id === rateCard.id && report.valuation.currency === rateCard.currency && report.valuation.basis === rateCard.basis;
  if (rateCard === undefined) notes.add("No supplied rate card; known recorded amounts remain unattributed to token categories.");
  else {
    notes.add("Calculated supplied-rate split reconciled to the selected total; it is not proof of billed category rates.");
    if (!reportCardMatches) notes.add("Supplied rate card id, currency or basis does not match the embedded valuation.");
  }
  let knownTotal = 0n;
  let charges = 0n;
  let credits = 0n;
  let unattributed = 0n;
  let rounding = 0n;
  let unknownCount = 0;
  const rows: OperationBudgetObservation[] = [];
  for (const line of selected) {
    const observation = evidenceById.get(line.observation_id)!;
    const amount = line.amount_nanos === null ? null : BigInt(line.amount_nanos);
    const partsResult = usageParts(observation);
    const rowCategories = CATEGORIES.map(emptyCategory);
    const rowNotes = new Set<string>();
    let unknownTokens = 0;
    let unpriced = 0;
    for (const category of CATEGORIES) {
      const quantity = partsResult.parts[category];
      const row = rowCategories.find(item => item.category === category)!;
      if (quantity === null) row.unknown_token_observations = 1;
      else row.tokens = quantity.toString();
    }
    unknownTokens = CATEGORIES.some(category => partsResult.parts[category] === null) ? 1 : 0;
    for (const reason of partsResult.reasons) rowNotes.add(reason);
    let rowUnattributed = amount ?? 0n;
    let rowRounding = 0n;
    if (amount === null) {
      unknownCount++;
      rowNotes.add(line.reason ?? "valued amount is unknown");
      for (const row of rowCategories) row.unpriced_observations = 1;
      unpriced = 1;
    } else if (!partsResult.canSplit) {
      for (const row of rowCategories) row.unpriced_observations = 1;
      unpriced = 1;
    } else if (!rateCard || !reportCardMatches) {
      for (const row of rowCategories) row.unpriced_observations = 1;
      unpriced = 1;
    } else {
      const match = uniqueRule(observation, rateCard);
      const rule = match.rule;
      const valuedRule = line.rate_rule_id === rule?.id;
      const exact = rule && valuedRule ? exactCategoryAmounts(rule, partsResult.parts) : undefined;
      if (!rule) rowNotes.add(match.reason ?? "rate rule is missing, mismatched or ambiguous");
      else if (!valuedRule) rowNotes.add("embedded valuation rate rule identity does not match the supplied rule");
      else if (!exact) rowNotes.add("one or more token categories has no supplied rate");
      if (exact && exact.combined === amount) {
        const sign = amount < 0n ? -1n : 1n;
        for (const row of rowCategories) row.amount_nanos = signed(exact.rounded[row.category], sign).toString();
        rowRounding = amount - rowCategories.reduce((sum, row) => sum + BigInt(row.amount_nanos), 0n);
        rowUnattributed = 0n;
      } else {
        rowNotes.add("component split does not reconcile to the selected valued line");
        for (const row of rowCategories) row.unpriced_observations = 1;
        unpriced = 1;
      }
    }
    if (amount !== null) {
      knownTotal += amount;
      if (amount >= 0n) charges += amount; else credits -= amount;
      unattributed += rowUnattributed;
      rounding += rowRounding;
    }
    for (const row of rowCategories) {
      const aggregate = categories.find(item => item.category === row.category)!;
      aggregate.tokens = (BigInt(aggregate.tokens) + BigInt(row.tokens)).toString();
      aggregate.unknown_token_observations += row.unknown_token_observations;
      aggregate.amount_nanos = (BigInt(aggregate.amount_nanos) + BigInt(row.amount_nanos)).toString();
      aggregate.unpriced_observations += row.unpriced_observations;
    }
    if (rowNotes.size > 0) for (const note of rowNotes) notes.add(`${line.observation_id}: ${note}`);
    rows.push({ observation_id: line.observation_id, operation_id: operationByObservation.get(line.observation_id) ?? null, amount_nanos: line.amount_nanos, categories: rowCategories, unattributed_amount_nanos: rowUnattributed.toString(), rounding_adjustment_nanos: rowRounding.toString(), unknown_token_observations: unknownTokens, unpriced_observations: unpriced, notes: [...rowNotes] });
  }
  return {
    dataset_id: report.dataset_id, currency: report.valuation.currency, basis: report.valuation.basis,
    ...(rateCard ? { rate_card_id: rateCard.id } : {}), operation_id: operationId ?? null, scope: operationId === undefined ? "whole_run" : "subtree",
    known_total_nanos: knownTotal.toString(), charges_nanos: charges.toString(), credits_nanos: credits.toString(), categories,
    unattributed_amount_nanos: unattributed.toString(), rounding_adjustment_nanos: rounding.toString(), unknown_observation_count: unknownCount,
    scope_observation_ids: selectedIds, unknown_cost_observation_ids: selected.filter(line => line.amount_nanos === null).map(line => line.observation_id), observations: rows, notes: [...notes],
  };
}
