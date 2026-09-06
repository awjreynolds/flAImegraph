# Frozen dogfooding evidence

The `codex/` files are allowlisted native-shaped records from this project's conversation and three linked research agents, frozen through 2026-09-06T16:36:00Z. Their source schema is Codex 0.153.4. The user authorized public derived usage/cost evidence for dogfooding.

Only usage counters, model settings, timestamps, hashed identifiers and selected activity categories are retained. Prompts, command text, tool results, filesystem paths and reasoning content are omitted. `codex/provenance.json` records raw-prefix and sanitized-file hashes without disclosing raw data.

Expected direct usage: 177 response observations, 21,092,039 input tokens including 19,225,472 cached input; 63,102 output including 7,445 reasoning tokens; zero recorded cache-write tokens. The 21,155,141 combined tokens represent repeated consumption across requests, not unique context size.

Under `examples/rates/enterprise-astra-scenario.json`, expected model-token valuation is **41,046,242,000 nanoUSD = $41.046242**. This is a selected public-rate scenario and partial capture, not an actual bill or full project cost. Captured aggregates/snapshots and compaction markers remain coverage evidence rather than additional charges.

Agent counts and subtotals: coordinator 88 / $20.669904; telemetry 28 / $6.530018; accounting 33 / $9.110380; profiles 28 / $4.735940. Reproducing these through the common importer, valuation and exporters is a release integration check.
