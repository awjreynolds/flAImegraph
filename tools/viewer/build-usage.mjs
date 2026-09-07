import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd();
await build({ stdin: { contents: 'export * from "./src/usage.ts"; export * from "./src/usage-profile.ts"; export * from "./src/usage-import.ts"; export * from "./src/efficiency.ts"; export * from "./src/benchmark-import.ts";', sourcefile: 'usage-browser.ts', resolveDir: root, loader: 'ts' }, outfile: resolve('viewer/lib/usage.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
for (const [source, destination] of [['usage','usage-core'],['usage-types','usage-types'],['usage-profile','usage-profile'],['usage-import','usage-import'],['efficiency','efficiency'],['efficiency-types','efficiency-types'],['benchmark-import','benchmark-import']]) {
  writeFileSync(`viewer/lib/${destination}.d.ts`, readFileSync(`dist/${source}.d.ts`, 'utf8').replace(/^export \{\};?\s*$/gm, ''));
}
writeFileSync('viewer/lib/usage.d.ts', 'export * from "./usage-core.js";\nexport * from "./usage-profile.js";\nexport * from "./usage-import.js";\nexport * from "./efficiency.js";\nexport * from "./benchmark-import.js";\nexport type * from "./usage-types.js";\nexport type * from "./efficiency-types.js";\n');
console.log('Built offline usage and analysis browser module');
