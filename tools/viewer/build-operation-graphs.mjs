/** Render the bundled reports with upstream FlameGraph at desktop and mobile widths. */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderOperationSvg, renderOperationBudgetSvg } from '../../dist/pricing.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicDirectory = join(root, 'viewer/public');
const rates = JSON.parse(await readFile(join(root, 'examples/rates/enterprise-astra-scenario.json'), 'utf8'));
const sizes = {};
for (const name of ['native', 'routing', 'files']) {
  const report = JSON.parse(await readFile(join(publicDirectory, `operation-${name}.json`), 'utf8'));
  for (const [suffix, width] of [['', 1400], ['-mobile', 400]]) {
    for (const measure of ['tokens', 'execution-charges', 'source-charges', 'operations']) {
      const svg = measure === 'tokens'
        ? renderOperationBudgetSvg(report, name === 'native' ? rates : undefined, width)
        : renderOperationSvg(report, { projection: measure === 'source-charges' ? 'source' : 'execution', measure: measure === 'operations' ? 'operations' : 'charges' }, width);
      const file = `operation-${name}-${measure}${suffix}.svg`;
      if (svg === null) { await rm(join(publicDirectory, file), { force: true }); continue; }
      const dimensions = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
      if (!dimensions) throw new Error(`Missing SVG dimensions: ${file}`);
      sizes[`/${file}`] = { width: Number(dimensions[1]), height: Number(dimensions[2]) };
      await writeFile(join(publicDirectory, file), svg);
    }
  }
}
await writeFile(join(root, 'viewer/lib/operation-graphs.json'), JSON.stringify(sizes, null, 2) + '\n');
console.log(`Rendered ${Object.keys(sizes).length} upstream graphs and their intrinsic dimensions.`);
