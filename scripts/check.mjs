import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildExampleCollection } from '../examples/collection.js';
import { validateScore } from '../src/score.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let count = 0;
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed for ${file}`);
      count++;
    }
  }
}
for (const directory of ['bin', 'src', 'examples', 'web']) walk(path.join(root, directory));
if (!fs.existsSync(path.join(root, 'web/index.html'))) throw new Error('The browser studio entry point is missing.');
const example = buildExampleCollection({ seed: 1 });
if (example.tracks.length !== 10) throw new Error('The example collection must contain ten complete scores.');
for (const score of example.tracks) {
  const result = validateScore(score);
  if (!result.valid) throw new Error(`Invalid example ${score.id}: ${JSON.stringify(result.issues)}`);
}
console.log(`Checked ${count} JavaScript files and all ten example scores.`);
