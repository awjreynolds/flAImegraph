# Context Explorer

A static browser application for flAImegraph 0.2 ContextReports. It provides request search, ordered context composition, source/revision details, reuse and transformation lineage, harness profiles, exact request cost and explicitly estimated allocation. The frozen research demonstration also embeds the existing upstream FlameGraph SVG with zoom/search.

Requires Node.js 22.13 or newer. From this directory:

```sh
npm ci
npm run dev
# Or create the static export:
npm run build
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist/client
```

Open the localhost URL in a browser. Select **Open report** to inspect your report. Loading is local to the browser, with a 20 MB file limit and the same embedded report validator as the CLI. There is no report upload, backend data store or browser persistence. Keep sensitive reports under your own control.

The built-in real capture is the frozen 0.1 Codex research demonstration: observed usage, a declared enterprise pricing scenario and explicitly unavailable prompt context. The lifecycle demonstration is synthetic and includes estimated token weights and summary transformations. Do not interpret it as real billing.

This directory mirrors the validated Sites source without account-specific hosting metadata. To publish your own Site, register your own project and configure the static output as `dist/client`. The original private deployment is for its owner; the source and GitHub release archive are public.

The bundled `lib/validator.js` is generated from the root runtime and JSON Schemas. After changing those contracts, run `node tools/viewer/build-validator.mjs viewer/lib/validator.js` from the repository root, and copy updated `src/context-types.ts` and `src/types.ts` into `viewer/lib/` before rebuilding.

Validation includes static export, TypeScript, lint and consumer-validator tests. Browser interactions and responsive visual checks remain unverified because the verification computer was locked. Optional WebMCP report-state and request-selection tools require a browser that supports `document.modelContext`; their browser execution is also unverified.
