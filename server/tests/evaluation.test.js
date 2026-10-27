import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../src/core/registry.js';
import { scenarios, CATEGORIES } from '../src/eval/scenarios/index.js';
import { buildDataset } from '../src/eval/dataset.js';

describe('evaluation suite', () => {
  it('has at least 100 scenarios across every required category', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(100);
    for (const category of CATEGORIES) {
      expect(
        scenarios.some((s) => s.category === category),
        category,
      ).toBe(true);
    }
  });

  it('covers all 50 modules', async () => {
    const dataset = buildDataset(await loadRegistry());
    expect(dataset.totals.modulesCovered).toBe(50);
  });

  it('only references real actions in expectations', async () => {
    const registry = await loadRegistry();
    const referenced = scenarios.flatMap((s) => [
      ...(s.expect?.actions ?? []).flat(),
      ...(s.expect?.forbid ?? []),
      ...(s.expect?.params ?? []).map(([id]) => id),
    ]);
    const unknown = referenced.filter((id) => !registry.get(id));
    expect(unknown).toEqual([]);
  });

  it('gives every scenario an automated assertion', () => {
    const unchecked = scenarios.filter((s) => {
      const e = s.expect ?? {};
      return !(e.actions?.length || e.state?.length || e.params?.length || e.noWrites || e.reply || e.forbid);
    });
    expect(unchecked.map((s) => s.id)).toEqual([]);
  });
});
