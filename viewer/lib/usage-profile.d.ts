import type { UsageGrouping, UsageReport } from "./usage-types.js";
export interface UsageProfileOptions {
    meter_id: string;
    group_by?: Array<UsageGrouping | "execution">;
}
export interface UsageProfileFrame {
    id: string;
    label: string;
}
export interface UsageProfileSample {
    observation_id: string;
    stack: UsageProfileFrame[];
    value: string;
    integer_value: string;
}
/** One meter at a time; subsets, currencies and unlike units are never combined. */
export interface UsageProfile {
    schema_version: "0.4.0";
    dataset_id: string;
    meter_id: string;
    unit: string;
    decimal_places: number;
    integer_unit: string;
    total: string;
    integer_total: string;
    group_by: Array<UsageGrouping | "execution">;
    samples: UsageProfileSample[];
    unknown_observation_ids: string[];
    excluded_observation_ids: string[];
    count_bases: string[];
    limitations: string[];
}
export declare function formatUsageInteger(value: string, places: number): string;
export declare function createUsageProfile(input: UsageReport, options: UsageProfileOptions): UsageProfile;
export declare function validateUsageProfile(value: unknown): UsageProfile;
