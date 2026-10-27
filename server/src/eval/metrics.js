import { CATEGORIES } from './scenarios/index.js';

/**
 * Nearest-rank percentile: the smallest observed value with at least p% of samples at or below
 * it. It always returns a real measurement (no interpolation), which keeps small samples honest:
 * with n = 40, p95 is the 38th-fastest request. Null/undefined samples are ignored.
 */
export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return Math.round(v[idx]);
}

const finite = (values) => values.filter((x) => Number.isFinite(x));
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const round = (x, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
const usd = (x) => Math.round(x * 1e6) / 1e6;
const ratio = (num, den) => (den ? num / den : null);

/** p50/p95 plus the sample size and spread, so a reader can judge how stable the tail is. */
export function distribution(values) {
  const v = finite(values);
  return {
    n: v.length,
    p50: percentile(v, 50),
    p95: percentile(v, 95),
    mean: v.length ? Math.round(mean(v)) : null,
    max: v.length ? Math.round(Math.max(...v)) : null,
  };
}

function latencyOf(results) {
  const reqs = results.flatMap((r) => r.requests);
  return {
    requests: reqs.length,
    // Requests that never produced a useful response (errors before any output). They are listed
    // rather than silently dropped from the percentiles.
    withoutUsefulResponse: reqs.filter((q) => q.firstUsefulMs == null).length,
    errored: reqs.filter((q) => q.errored).length,
    withConfirmation: reqs.filter((q) => q.confirmations > 0).length,
    firstUseful: distribution(reqs.map((q) => q.firstUsefulMs)),
    firstResult: distribution(reqs.map((q) => q.firstResultMs)),
    endToEnd: distribution(reqs.map((q) => q.totalMs)),
    scenarioEndToEnd: distribution(results.map((r) => r.totals.totalMs)),
  };
}

function qualityOf(results) {
  const sumChecks = (key) =>
    results.reduce((a, r) => ({ passed: a.passed + (r[key]?.passed ?? 0), n: a.n + (r[key]?.n ?? 0) }), {
      passed: 0,
      n: 0,
    });
  const params = sumChecks('params');
  const state = sumChecks('state');
  return {
    scenarios: results.length,
    taskSuccess: ratio(results.filter((r) => r.success).length, results.length) ?? 0,
    actionSelection: ratio(results.filter((r) => r.selection.pass).length, results.length) ?? 0,
    actionRecall: round(mean(results.map((r) => r.selection.score)), 4),
    parameterAccuracy: params.n ? params.passed / params.n : null,
    parameterChecks: params.n,
    finalStateAccuracy: state.n ? state.passed / state.n : null,
    finalStateChecks: state.n,
    unsafeActions: results.reduce((a, r) => a + (r.unsafe ?? 0), 0),
    unsafeBreakdown: {
      writesWhenForbidden: results.reduce((a, r) => a + (r.unsafeDetail?.writesWhenForbidden ?? 0), 0),
      unconfirmedRisky: results.reduce((a, r) => a + (r.unsafeDetail?.unconfirmedRisky ?? 0), 0),
    },
  };
}

function costOf(results) {
  const reqs = results.flatMap((r) => r.requests);
  const total = results.reduce((a, r) => a + r.totals.costUsd, 0);
  const successes = results.filter((r) => r.success).length;
  const sum = (k) => reqs.reduce((a, q) => a + (q[k] ?? 0), 0);
  const per = (k) => round(mean(reqs.map((q) => q[k] ?? 0)));
  return {
    totalUsd: usd(total),
    perRequestUsd: usd(total / Math.max(reqs.length, 1)),
    perScenarioUsd: usd(total / Math.max(results.length, 1)),
    // Includes the cost of failed scenarios: what you pay for each task that actually worked.
    perSuccessfulTaskUsd: successes ? usd(total / successes) : null,
    requestCost: distribution(reqs.map((q) => q.costUsd * 1e6)), // micro-dollars, for p50/p95
    modelCallsPerRequest: per('modelCalls'),
    embeddingCallsPerRequest: per('embeddingCalls'),
    modelCallsPerScenario: round(mean(results.map((r) => r.totals.modelCalls))),
    inputTokensPerRequest: Math.round(mean(reqs.map((q) => q.inputTokens))),
    cachedTokensPerRequest: Math.round(mean(reqs.map((q) => q.cachedTokens))),
    outputTokensPerRequest: Math.round(mean(reqs.map((q) => q.outputTokens))),
    cacheHitRate: round(sum('cachedTokens') / Math.max(sum('inputTokens'), 1), 3),
    retries: sum('retries'),
    failedModelCalls: sum('failedModelCalls'),
  };
}

/** Task success per repeat, so `--repeat N` shows run-to-run variance instead of hiding it. */
function stability(results) {
  const repeats = [...new Set(results.map((r) => r.repeat ?? 0))].sort((a, b) => a - b);
  if (repeats.length < 2) return null;
  const perRepeat = repeats.map((k) => {
    const rs = results.filter((r) => (r.repeat ?? 0) === k);
    return rs.filter((r) => r.success).length / rs.length;
  });
  const byScenario = new Map();
  for (const r of results) byScenario.set(r.id, [...(byScenario.get(r.id) ?? []), r.success]);
  const flaky = [...byScenario].filter(([, v]) => v.some(Boolean) && !v.every(Boolean)).map(([id]) => id);
  return {
    repeats: repeats.length,
    taskSuccessPerRepeat: perRepeat.map((x) => round(x, 4)),
    min: round(Math.min(...perRepeat), 4),
    max: round(Math.max(...perRepeat), 4),
    flakyScenarios: flaky,
  };
}

export function aggregate(results) {
  const by = (pred) => results.filter(pred);
  const groups = {
    direct: by((r) => r.group === 'direct'),
    complex: by((r) => r.group === 'complex'),
    other: by((r) => r.group === 'other'),
  };
  return {
    latency: {
      direct: latencyOf(groups.direct),
      complex: latencyOf(groups.complex),
      other: latencyOf(groups.other),
      all: latencyOf(results),
    },
    cost: {
      ...costOf(results),
      direct: costOf(groups.direct),
      complex: costOf(groups.complex),
      other: costOf(groups.other),
    },
    quality: {
      ...qualityOf(results),
      stability: stability(results),
      byCategory: Object.fromEntries(
        CATEGORIES.map((c) => [c, qualityOf(by((r) => r.category === c))]).filter(([, q]) => q.scenarios),
      ),
    },
    failures: results
      .filter((r) => !r.success)
      .map((r) => ({
        id: r.id,
        category: r.category,
        ...(r.repeat ? { repeat: r.repeat } : {}),
        failed: r.checks
          .filter((c) => !c.pass)
          .map((c) => `${c.kind}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
        lastReply: r.requests.at(-1)?.reply?.slice(0, 300),
      })),
  };
}
