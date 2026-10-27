import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REFERENCE_NOW } from '../core/clock.js';
import { loadRegistry } from '../core/registry.js';
import { scenarios, CATEGORIES, latencyGroup } from './scenarios/index.js';
import { RESULTS_DIR } from './run.js';

const describeAction = (a) => [].concat(a).join(' | ');

/** Serializable view of the scenario suite: inputs, expected outcomes and the checks applied. */
export function buildDataset(registry) {
  const moduleIds = registry.listModules().map((m) => m.id);
  const covered = new Set(scenarios.flatMap((s) => s.modules ?? []));
  return {
    version: 1,
    fixedNow: REFERENCE_NOW,
    seed: 42,
    totals: {
      scenarios: scenarios.length,
      byCategory: Object.fromEntries(
        CATEGORIES.map((c) => [c, scenarios.filter((s) => s.category === c).length]),
      ),
      modulesCovered: moduleIds.filter((m) => covered.has(m)).length,
      modulesTotal: moduleIds.length,
    },
    scenarios: scenarios.map((s) => {
      const e = s.expect ?? {};
      return {
        id: s.id,
        category: s.category,
        latencyGroup: latencyGroup(s),
        modules: s.modules ?? [],
        turns: s.turns,
        autoConfirm: s.autoConfirm !== false,
        expected: {
          actions: (e.actions ?? []).map(describeAction),
          forbiddenActions: e.forbid ?? [],
          forbiddenEffects: e.forbidEffects ?? [],
          parameters: (e.params ?? []).map(([id, , label]) => label ?? `${id} params`),
          noWrites: Boolean(e.noWrites),
          reply: e.reply ? String(e.reply) : null,
          finalState: (e.state ?? []).map(([name]) => name),
        },
      };
    }),
  };
}

if (process.argv[1]?.endsWith('dataset.js')) {
  const dataset = buildDataset(await loadRegistry());
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, 'eval-dataset.json');
  writeFileSync(file, `${JSON.stringify(dataset, null, 2)}\n`);
  const { totals } = dataset;
  console.log(
    `Wrote ${path.relative(process.cwd(), file)}: ${totals.scenarios} scenarios, ` +
      `${totals.modulesCovered}/${totals.modulesTotal} modules covered`,
  );
}
