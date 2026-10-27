// Writes the deterministic seed to results/seed-data.json so the synthetic data can be inspected,
// diffed or loaded elsewhere. The running app never reads this file: it rebuilds the same data in
// memory on start and on "Reset data".
//
//   npm run seed                         reference date (2026-10-15T10:00Z), seed 42
//   npm run seed -- --now today          generated around the real current date
//   npm run seed -- --now 2026-11-01T09:00:00Z --seed 7 --out /tmp/seed.json
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { REFERENCE_NOW, createClock } from '../core/clock.js';
import { buildSeed } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.join(here, '..', '..', 'results', 'seed-data.json');

function fail(message) {
  console.error(`seed: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    now: { type: 'string', default: REFERENCE_NOW },
    seed: { type: 'string', default: process.env.SEED || '42' },
    out: { type: 'string', default: DEFAULT_OUT },
  },
});

const now = values.now === 'today' ? new Date().toISOString() : values.now;
if (Number.isNaN(Date.parse(now))) fail(`--now must be an ISO date or "today", got "${values.now}"`);
const seed = Number(values.seed);
if (!Number.isInteger(seed)) fail(`--seed must be an integer, got "${values.seed}"`);

const clock = createClock(new Date(now).toISOString());
const snapshot = buildSeed(clock, seed);
const counts = Object.fromEntries(
  Object.entries(snapshot.data)
    .map(([name, rows]) => [name, rows.length])
    .sort(([a], [b]) => a.localeCompare(b)),
);

const out = path.resolve(values.out);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ generatedFor: clock.nowIso(), seed, counts, ...snapshot }, null, 2)}\n`,
);

const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
console.log(
  `Wrote ${path.relative(process.cwd(), out)}: ${total} records in ${Object.keys(counts).length} collections`,
);
console.log(`Date: ${clock.nowIso()} · seed ${seed}`);
