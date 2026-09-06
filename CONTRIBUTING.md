# Contributing to flAImegraph and the interchange specification

The specification and reference implementation evolve together. Start with a concrete interchange or accounting problem, check the existing standards and researched implementations, and add an independently worked conformance example before changing behavior.

Use `npm ci`, then `npm run check` and `npm run build`. Tests exercise public interfaces. Keep expected quantities independent from the implementation and preserve a failing-test-before-fix record for behavioral changes. Native adapter fixtures must identify their source format/version and omit private content.

Proposals affecting identity, accounting selection, monetary meaning, rounding, allocation or profile encoding must include compatibility and migration implications. A new field or diagram does not establish semantic interoperability. Experimental and stable claims follow [the specification's conformance policy](spec/0.1/conformance.md).

Implementation work is split into bounded ownership. Luna max implementers receive precise findings and a correction opportunity; persistent failures escalate to Astra low, then Astra medium when needed. Sol medium supplies independent review; the orchestrator owns final integration and acceptance. These are project execution choices, not requirements on other implementations of the specification.

Use our own project work as a [dogfooding case](docs/dogfooding.md), preserving the observation scope and valuation assumptions. Keep independent consumer checks and other harness fixtures so project-specific success does not masquerade as portability.
