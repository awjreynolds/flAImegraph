import type { OperationReport } from "./operation-types.js";
import type { RateCard, Valuation } from "./types.js";
declare const CATEGORIES: readonly ["input", "cache_read", "cache_write", "output"];
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
/**
 * Project selected valued observations into token categories and exact money.
 * This is an analysis projection: supplied rates are checked against the
 * embedded valuation but are not a proof of the provider's billed breakdown.
 */
export declare function createOperationBudget(input: OperationReport, suppliedRateCard?: RateCard, operationId?: string): OperationBudget;
