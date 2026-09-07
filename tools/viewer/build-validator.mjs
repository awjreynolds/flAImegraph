/** Bundle the public validator for offline browsers; schemas are embedded, never fetched. */
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Ajv } from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.argv[2] ?? '.local/browser-validator.mjs');
const schemas = {};
for (const [version, names] of [['0.1', ['evidence','valuation','rate-card','work-item']], ['0.2', ['context','harness-profile','context-report']], ['0.3', ['operations']]]) {
  for (const name of names) schemas[`/spec/${version}/schemas/${name}.schema.json`] = readFileSync(resolve(root, `spec/${version}/schemas/${name}.schema.json`), 'utf8');
}
mkdirSync(dirname(output), { recursive: true });
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true, validateFormats: false, code: { source: true, esm: true } });
const validators = {};
const ids = {};
Object.values(schemas).forEach((text, index) => {
  const schema = JSON.parse(text);
  ajv.addSchema(schema);
  validators[`schema${index}`] = schema.$id;
  ids[schema.$id] = `schema${index}`;
});
const compiledSchemas = standaloneCode(ajv, validators);
await build({
  stdin: { contents: 'export { validateContextReport, createContextReport } from "./src/context-report.ts"; export { validateOperationReport, validateOperationBundle } from "./src/operations.ts";', resolveDir: root, sourcefile: 'browser-validator.ts', loader: 'ts' },
  outfile: output, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  define: {'import.meta.url': JSON.stringify('https://embedded.invalid/src/context-report.js')},
  plugins: [{ name: 'offline-validator-resources', setup(builder) {
    builder.onResolve({filter: /^(node:fs|node:crypto|node:zlib|protobufjs|ajv|compiled-schemas)$/}, args => ({path: args.path, namespace: 'validator-resource', sideEffects: false}));
    builder.onLoad({filter: /.*/,namespace:'validator-resource'}, args => {
      if (args.path === 'compiled-schemas') return {contents: compiledSchemas, loader:'js', resolveDir:root};
      if (args.path === 'ajv') return {contents:`import * as validators from 'compiled-schemas'; const ids=${JSON.stringify(ids)}; export class Ajv {addSchema(){} compile(schema){const result=validators[ids[schema.$id]];if(!result)throw new Error('Schema is not compiled: '+schema.$id);return result}}`,loader:'js'};
      if (args.path === 'node:fs') return { contents: `const schemas=${JSON.stringify(schemas)};export function readFileSync(url){const path=new URL(url).pathname;const result=schemas[path];if(result===undefined)throw new Error('Schema is not embedded: '+path);return result}`, loader:'js' };
      if (args.path === 'protobufjs') return {contents:'export default {};',loader:'js'};
      const name = args.path === 'node:crypto' ? 'createHash' : 'gzipSync';
      return {contents:`export function ${name}(){throw new Error('The browser validator does not provide ${name}');}`,loader:'js'};
    });
  }}],
});
console.log(output);
