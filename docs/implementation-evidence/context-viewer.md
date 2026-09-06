# Context Explorer verification

The explorer is a static React application built with the Sites vinext starter and its installed shadcn controls. The public source is in `viewer/`. The static deployment archive contains only the exported HTML, RSC payload and browser assets; there is no application server, report upload endpoint, database or provider integration.

The page supports a frozen real research report and an explicitly synthetic lifecycle report, local JSON loading with a 20 MB limit, request filtering/selection, ordered context occurrences, source and revision details, reuse, summary lineage, harness facts/overrides, exact decimal USD and opt-in estimated allocation. The trusted research SVG is generated with the existing upstream FlameGraph renderer. Arbitrary imported SVGs are not executed.

The browser validator is bundled from the public runtime with embedded JSON Schemas; tests exercise its agreement with the Node consumer and malformed reports. TypeScript, lint and a static export passed. The generated index and client assets were packaged successfully. Browser interaction, responsive layout and WebMCP execution remain unverified because the verification Mac was locked. That limitation is not described as a successful browser test.

The source starter's dependency advisory check on 6 September 2026 reported six production-tree entries (five high, one low), covering React server functions, image parsers, HTTP-client behavior and development servers. These packages are used in the build/development toolchain; their server implementations are not deployed in this static export. The report is not a claim that the toolchain is vulnerability-free. Consumers should keep development servers on loopback and reassess advisories before using this source as a server-backed application. No forced dependency upgrade was applied to the validated starter during release.

The owner-private deployment completed successfully on 6 September 2026. The deployment handoff was queued in Codex; this does not establish an interactive browser test. The public release also includes a portable static archive without account-specific hosting metadata.
