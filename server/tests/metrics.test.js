import { describe, expect, it } from 'vitest';
import { aggregate, distribution, percentile } from '../src/eval/metrics.js';
import { toUserRequests, unconfirmedRiskyCalls } from '../src/eval/run.js';
import { checkTargets, readmeSummary } from '../src/eval/bench.js';

const usage = (over = {}) => ({
  firstUsefulMs: 100,
  firstResultMs: 200,
  totalMs: 1000,
  modelCalls: 1,
  embeddingCalls: 1,
  failedModelCalls: 0,
  inputTokens: 1000,
  cachedTokens: 500,
  outputTokens: 100,
  costUsd: 0.001,
  retries: 0,
  ...over,
});
const turn = (kind, outcome, summary, actionCalls = []) => ({
  kind,
  input: kind === 'confirm' ? '(confirm)' : 'msg',
  outcome,
  reply: outcome,
  summary,
  trace: { actionCalls },
});
const registry = {
  get: (id) => ({ effect: { 'sms.send': 'external', 'tasks.create': 'write' }[id] ?? 'read' }),
};

describe('percentiles', () => {
  it('uses nearest rank and ignores missing samples', () => {
    const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(percentile(values, 50)).toBe(1000);
    expect(percentile(values, 95)).toBe(1900);
    expect(percentile([null, undefined, 5], 50)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });

  it('reports the sample size next to p50/p95', () => {
    expect(distribution([3, 1, 2, null])).toEqual({ n: 3, p50: 2, p95: 3, mean: 2, max: 3 });
  });
});

describe('user requests', () => {
  it('folds a confirmation round-trip into the request that triggered it', () => {
    const requests = toUserRequests([
      turn('message', 'confirm', usage({ totalMs: 1500, firstUsefulMs: 400, firstResultMs: 1400 })),
      turn('confirm', 'completed', usage({ totalMs: 300, modelCalls: 0, costUsd: 0, firstUsefulMs: 5 })),
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      totalMs: 1800,
      firstUsefulMs: 400,
      firstResultMs: 1400,
      modelCalls: 1,
      costUsd: 0.001,
      confirmations: 1,
      outcome: 'completed',
    });
  });

  it('offsets a first response that only arrives after confirmation', () => {
    const [r] = toUserRequests([
      turn('message', 'confirm', usage({ totalMs: 1000, firstResultMs: null })),
      turn('confirm', 'completed', usage({ totalMs: 500, firstResultMs: 50 })),
    ]);
    expect(r.firstResultMs).toBe(1050);
  });

  it('keeps separate user messages separate', () => {
    expect(
      toUserRequests([turn('message', 'completed', usage()), turn('message', 'completed', usage())]),
    ).toHaveLength(2);
  });
});

describe('safety', () => {
  it('flags external actions that ran without a preceding confirmation', () => {
    const risky = [{ id: 'sms.send', ok: true }];
    expect(unconfirmedRiskyCalls([turn('message', 'completed', usage(), risky)], registry)).toEqual([
      'sms.send',
    ]);
    expect(
      unconfirmedRiskyCalls(
        [turn('message', 'confirm', usage()), turn('confirm', 'completed', usage(), risky)],
        registry,
      ),
    ).toEqual([]);
  });

  it('ignores ordinary writes and failed calls', () => {
    const calls = [
      { id: 'tasks.create', ok: true },
      { id: 'sms.send', ok: false },
    ];
    expect(unconfirmedRiskyCalls([turn('message', 'completed', usage(), calls)], registry)).toEqual([]);
  });
});

describe('aggregate', () => {
  const scenario = (id, group, success, requests, extra = {}) => ({
    id,
    category: group === 'direct' ? 'direct' : 'multi_step',
    group,
    success,
    selection: { pass: success, score: success ? 1 : 0.5 },
    params: { passed: 1, n: 1 },
    state: { passed: success ? 1 : 0, n: 1 },
    unsafe: 0,
    checks: success ? [] : [{ kind: 'state', name: 'x', pass: false }],
    requests,
    totals: {
      costUsd: requests.reduce((a, q) => a + q.costUsd, 0),
      modelCalls: requests.reduce((a, q) => a + q.modelCalls, 0),
      totalMs: requests.reduce((a, q) => a + q.totalMs, 0),
    },
    ...extra,
  });
  const req = (over) => ({ ...usage(over), confirmations: 0, errored: false });

  it('reports latency per group, cost per successful task and stability across repeats', () => {
    const results = [
      scenario('D1', 'direct', true, [req({ totalMs: 800 })], { repeat: 0 }),
      scenario('D1', 'direct', false, [req({ totalMs: 1200 })], { repeat: 1 }),
      scenario('M1', 'complex', true, [req({ totalMs: 3000, costUsd: 0.004 })], { repeat: 0 }),
      scenario('M1', 'complex', true, [req({ totalMs: 5000, costUsd: 0.004 })], { repeat: 1 }),
    ];
    const s = aggregate(results);
    expect(s.latency.direct.endToEnd).toMatchObject({ n: 2, p50: 800, p95: 1200 });
    expect(s.latency.complex.endToEnd).toMatchObject({ n: 2, p50: 3000, p95: 5000 });
    expect(s.cost.totalUsd).toBeCloseTo(0.01);
    expect(s.cost.perSuccessfulTaskUsd).toBeCloseTo(0.01 / 3);
    expect(s.cost.modelCallsPerRequest).toBe(1);
    expect(s.quality.finalStateAccuracy).toBe(0.75);
    expect(s.quality.stability).toMatchObject({ repeats: 2, flakyScenarios: ['D1'] });
    expect(s.failures).toHaveLength(1);

    const targets = checkTargets(s);
    expect(targets.find((t) => t.name === 'Direct: end-to-end p95')).toMatchObject({
      value: 1200,
      met: true,
    });
    const table = readmeSummary({
      generatedAt: '2026-10-27T00:00:00Z',
      targets: { optimized: targets },
      runs: {
        optimized: {
          conditions: {
            scenarios: 2,
            repeat: 2,
            models: { planner: 'gpt-4.1-mini' },
            retrieval: 'hybrid',
            concurrency: 4,
            fixedNow: '2026-10-15T10:00:00.000Z',
          },
          summary: s,
        },
      },
    });
    expect(table).toContain('| Direct: end-to-end p95 | 1.20s | ≤ 6.00s | yes |');
  });

  it('marks parameter accuracy as not measured when no scenario checks parameters', () => {
    const s = aggregate([{ ...scenario('X', 'other', true, [req()]), params: { passed: 0, n: 0 } }]);
    expect(s.quality.parameterAccuracy).toBeNull();
  });
});
