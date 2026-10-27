import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadRegistry } from '../src/core/registry.js';
import { runSmoke } from '../src/catalog/smoke.js';

const reference = JSON.parse(readFileSync(new URL('../src/catalog/reference-catalog.json', import.meta.url)));
const registry = await loadRegistry();

describe('catalog', () => {
  it('has exactly 50 modules x 10 actions matching the official catalog titles', () => {
    expect(registry.listModules()).toHaveLength(50);
    for (const m of registry.listModules()) expect(m.actions, m.id).toHaveLength(10);
    expect(registry.list()).toHaveLength(500);
    for (const a of registry.list()) expect(a.title, a.ref).toBe(reference[a.ref]);
  });
  it('every action has description, effect, input and output schemas', () => {
    for (const a of registry.list()) {
      expect(a.description.length, a.id).toBeGreaterThan(10);
      expect(['read', 'write', 'destructive', 'external']).toContain(a.effect);
      expect(a.inputJsonSchema.type, a.id).toBe('object');
      expect(a.outputJsonSchema, a.id).toBeTruthy();
    }
  });
});

describe('500 handler smoke test', async () => {
  const report = await runSmoke();
  for (const r of report.results) {
    it(`${r.ref} ${r.id}`, () => {
      expect(r.crashed, 'invalid input must not crash').toBeNull();
      expect(r.ok, JSON.stringify(r.attempts?.[0])).toBe(true);
    });
  }
});
