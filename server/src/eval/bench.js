import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runEval, RESULTS_DIR } from './run.js';
import { TARGETS } from './targets.js';
import { hasApiKey, config } from '../agent/config.js';
import { pricingTable, priceFor } from '../agent/pricing.js';
import { loadRegistry } from '../core/registry.js';
import { buildDataset } from './dataset.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const flag = (k) => process.argv.includes(`--${k}`);
const fmtMs = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`);
const dist = (d) => (d ? `${fmtMs(d.p50)} / ${fmtMs(d.p95)}` : '–');
const microUsd = (d) =>
  d?.p50 == null ? '–' : `$${(d.p50 / 1e6).toFixed(5)} / $${(d.p95 / 1e6).toFixed(5)}`;
const SMALL_SAMPLE = 40;
const pct = (v) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
const usd = (v) => (v == null ? '–' : `$${v.toFixed(5)}`);

const ratio = (base, opt) => (base && opt ? base / opt : null);
const change = (base, opt) => (base && opt != null ? (opt - base) / base : null);
const signed = (v) => (v == null ? '–' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`);
const points = (base, opt) =>
  base == null || opt == null ? '–' : `${opt >= base ? '+' : ''}${((opt - base) * 100).toFixed(1)} pts`;

function costComparison(ratioValue) {
  if (!ratioValue) return '';
  if (Math.abs(ratioValue - 1) < 0.05) return ' (about the same)';
  return ratioValue > 1
    ? ` (${ratioValue.toFixed(1)}× cheaper)`
    : ` (${(1 / ratioValue).toFixed(1)}× more expensive)`;
}

/** Plain-language comparison derived from the measured numbers; nothing here is hardcoded. */
function tradeoffs(b, o) {
  const B = b.summary;
  const O = o.summary;
  const cheaper = ratio(B.cost.perRequestUsd, O.cost.perRequestUsd);
  const lines = [
    '## Trade-offs: where the optimized design gains and what it costs',
    '',
    `- **Cost:** ${usd(B.cost.perRequestUsd)} → ${usd(O.cost.perRequestUsd)} per request` +
      costComparison(cheaper) +
      `; per successful task ${usd(B.cost.perSuccessfulTaskUsd)} → ${usd(O.cost.perSuccessfulTaskUsd)}.`,
    `- **Model calls:** ${B.cost.modelCallsPerRequest} → ${O.cost.modelCallsPerRequest} per request; input tokens ${B.cost.inputTokensPerRequest} → ${O.cost.inputTokensPerRequest} (${signed(change(B.cost.inputTokensPerRequest, O.cost.inputTokensPerRequest))}), cached share ${pct(B.cost.cacheHitRate)} → ${pct(O.cost.cacheHitRate)}.`,
    `- **Latency, direct:** first useful p50 ${signed(change(B.latency.direct.firstUseful.p50, O.latency.direct.firstUseful.p50))}, end-to-end p50 ${signed(change(B.latency.direct.endToEnd.p50, O.latency.direct.endToEnd.p50))}, p95 ${signed(change(B.latency.direct.endToEnd.p95, O.latency.direct.endToEnd.p95))}.`,
    `- **Latency, complex:** first useful p50 ${signed(change(B.latency.complex.firstUseful.p50, O.latency.complex.firstUseful.p50))}, end-to-end p50 ${signed(change(B.latency.complex.endToEnd.p50, O.latency.complex.endToEnd.p50))}, p95 ${signed(change(B.latency.complex.endToEnd.p95, O.latency.complex.endToEnd.p95))}.`,
    `- **Quality:** task success ${points(B.quality.taskSuccess, O.quality.taskSuccess)}, action selection ${points(B.quality.actionSelection, O.quality.actionSelection)}, parameter accuracy ${points(B.quality.parameterAccuracy, O.quality.parameterAccuracy)}, unsafe actions ${B.quality.unsafeActions} → ${O.quality.unsafeActions}.`,
  ];
  const shifts = Object.keys(O.quality.byCategory)
    .map((c) => [c, B.quality.byCategory[c]?.taskSuccess, O.quality.byCategory[c]?.taskSuccess])
    .filter(([, bv, ov]) => bv != null && ov != null && Math.abs(ov - bv) >= 0.05);
  if (shifts.length) {
    lines.push(
      `- **Categories that moved ≥ 5 pts:** ${shifts.map(([c, bv, ov]) => `${c} ${points(bv, ov)}`).join(', ')}.`,
    );
  }
  lines.push(
    '',
    'Where the gains come from: retrieval sends ~35 action schemas instead of 500; one planning call replaces a model call per step; filters, exclusions and assignment run as code instead of model reasoning; independent steps run in parallel; the static prompt prefix is cacheable; confirmed plans resume without a model call; simple results use a template instead of a summary call.',
    '',
    'What it gives up: the plan is written before data is seen, so heavily data-dependent branching relies on `final: false` continuation or a repair call, and a retrieval miss depends on the `need_tools` fallback. The failure lists below show where this mattered.',
    '',
  );
  return lines;
}

export function checkTargets(s) {
  const T = TARGETS;
  const L = s.latency;
  const C = s.cost;
  const Q = s.quality;
  const rows = [
    ['Direct: first useful p50', L.direct.firstUseful.p50, T.latency.direct.firstUsefulP50, 'max', fmtMs],
    ['Direct: first useful p95', L.direct.firstUseful.p95, T.latency.direct.firstUsefulP95, 'max', fmtMs],
    ['Direct: end-to-end p50', L.direct.endToEnd.p50, T.latency.direct.endToEndP50, 'max', fmtMs],
    ['Direct: end-to-end p95', L.direct.endToEnd.p95, T.latency.direct.endToEndP95, 'max', fmtMs],
    ['Complex: first useful p50', L.complex.firstUseful.p50, T.latency.complex.firstUsefulP50, 'max', fmtMs],
    ['Complex: first useful p95', L.complex.firstUseful.p95, T.latency.complex.firstUsefulP95, 'max', fmtMs],
    [
      'Complex: end-to-end p50 (per request)',
      L.complex.endToEnd.p50,
      T.latency.complex.endToEndP50,
      'max',
      fmtMs,
    ],
    [
      'Complex: end-to-end p95 (per request)',
      L.complex.endToEnd.p95,
      T.latency.complex.endToEndP95,
      'max',
      fmtMs,
    ],
    ['Cost per direct request', C.direct.perRequestUsd, T.cost.perDirectRequestUsd, 'max', usd],
    ['Cost per complex scenario', C.complex.perScenarioUsd, T.cost.perComplexScenarioUsd, 'max', usd],
    ['Cost per successful task', C.perSuccessfulTaskUsd, T.cost.perSuccessfulTaskUsd, 'max', usd],
    ['Task success (all)', Q.taskSuccess, T.quality.taskSuccessOverall, 'min', pct],
    ['Task success (direct)', Q.byCategory.direct?.taskSuccess, T.quality.taskSuccessDirect, 'min', pct],
    ['Action selection', Q.actionSelection, T.quality.actionSelection, 'min', pct],
    ['Parameter accuracy', Q.parameterAccuracy, T.quality.parameterAccuracy, 'min', pct],
    ['Unsafe actions', Q.unsafeActions, T.quality.unsafeActions, 'max', (v) => String(v)],
  ];
  return rows.map(([name, value, target, dir, f]) => ({
    name,
    value,
    target,
    measured: value != null,
    met: value != null && (dir === 'max' ? value <= target : value >= target),
    display: f(value),
    targetDisplay: `${dir === 'max' ? '≤' : '≥'} ${f(target)}`,
  }));
}

function markdown(report) {
  const { optimized: o, baseline: b } = report.runs;
  const lines = [];
  lines.push(
    '# Benchmark results',
    '',
    `Generated ${report.generatedAt}. Scenarios: ${o.conditions.scenarios} (×${o.conditions.repeat}). Fixed clock: ${o.conditions.fixedNow}. Concurrency: ${o.conditions.concurrency}. Node ${o.conditions.node}.`,
    '',
  );
  lines.push(
    '## Test conditions',
    '',
    `- Optimized: planner \`${o.conditions.models.planner}\`, summarizer \`${o.conditions.models.summary}\`, retrieval \`${o.conditions.retrieval}\`${o.conditions.models.embedding ? ` (\`${o.conditions.models.embedding}\`)` : ''}, top-K ${o.conditions.topK}, summary mode \`${o.conditions.summaryMode}\``,
  );
  if (b)
    lines.push(
      `- Baseline: \`${b.conditions.models.agent}\` with the full 500-action catalog in the system prompt and a single call_action tool (ReAct loop)`,
    );
  lines.push(
    `- Pricing (USD / 1M tokens, input / cached input / output): ${[
      ...new Set(
        [
          o.conditions.models.planner,
          o.conditions.models.summary,
          b?.conditions.models.agent,
          o.conditions.models.embedding,
        ].filter(Boolean),
      ),
    ]
      .map((m) => {
        const p = priceFor(m);
        return `\`${m}\` ${p.input} / ${p.cachedInput} / ${p.output}`;
      })
      .join('; ')}`,
  );
  lines.push(
    '- Cost includes every model call: planning, plan repairs, retries, summaries and query embeddings. OpenAI prompt caching is automatic for prompt prefixes ≥ 1,024 tokens; cached tokens are billed at the cached rate shown above. Rate-limit/5xx retries are not billed by OpenAI but their wait time is included in latency.',
    `- One-time catalog embedding: ${o.conditions.catalogEmbedding ? (o.conditions.catalogEmbedding.computed ? `computed this run, ${usd(o.conditions.catalogEmbedding.costUsd)} (setup cost, not included per request)` : 'loaded from the on-disk cache (no cost this run)') : 'not recorded'}.`,
    '- **Request** = one user message, including any confirmation round-trip it triggers (the runner approves immediately, so user think-time is excluded). **First useful** = first event with request-specific content (plan sentence, question, confirmation, step result or answer text); spinners never count. **First grounded result** = first step result, question, confirmation or answer text — i.e. excluding the plan sentence, which is written before any data is read. Percentiles are nearest-rank.',
    '- Latency groups: **direct** = the 50 single-action scenarios; **complex** = multi-step, conditional and follow-up scenarios; **other** = indirect, ambiguous, unsupported and failure scenarios.',
    '',
  );
  const n = Math.min(o.summary.latency.direct.requests, o.summary.latency.complex.requests);
  if (n < SMALL_SAMPLE)
    lines.push(
      `> **Sample size:** the smallest latency group has ${n} requests, so its p95 is close to the slowest single request. Run \`npm run bench -- --repeat 3\` for a steadier tail.`,
      '',
    );
  lines.push(
    '## Targets (set before running)',
    '',
    '| Metric | Target | Optimized | Met? |',
    '|---|---|---|---|',
  );
  for (const t of report.targets.optimized)
    lines.push(
      `| ${t.name} | ${t.targetDisplay} | ${t.display} | ${!t.measured ? 'not measured' : t.met ? 'yes' : '**MISSED**'} |`,
    );
  lines.push('');
  if (b) {
    const row = (name, f, get) => `| ${name} | ${f(get(b.summary))} | ${f(get(o.summary))} |`;
    lines.push(
      '## Baseline vs optimized (same scenarios)',
      '',
      '| Metric | Baseline | Optimized |',
      '|---|---|---|',
    );
    const group = (name, key) => [
      row(
        `${name}: first useful p50 / p95`,
        (x) => x,
        (s) => dist(s.latency[key].firstUseful),
      ),
      row(
        `${name}: first grounded result p50 / p95`,
        (x) => x,
        (s) => dist(s.latency[key].firstResult),
      ),
      row(
        `${name}: end-to-end p50 / p95`,
        (x) => x,
        (s) => dist(s.latency[key].endToEnd),
      ),
      row(`${name}: requests measured (n)`, String, (s) => s.latency[key].requests),
    ];
    lines.push(
      row('Task success', pct, (s) => s.quality.taskSuccess),
      row('Action selection', pct, (s) => s.quality.actionSelection),
      row('Parameter accuracy', pct, (s) => s.quality.parameterAccuracy),
      row('Final-state checks passed', pct, (s) => s.quality.finalStateAccuracy),
      row('Unsafe actions (forbidden writes + unconfirmed risky)', String, (s) =>
        s.quality.unsafeBreakdown
          ? `${s.quality.unsafeActions} (${s.quality.unsafeBreakdown.writesWhenForbidden} + ${s.quality.unsafeBreakdown.unconfirmedRisky})`
          : s.quality.unsafeActions,
      ),
      ...group('Direct', 'direct'),
      ...group('Complex', 'complex'),
      ...group('Other (indirect, ambiguous, unsupported, failure)', 'other'),
      row(
        'Complex scenario end-to-end p50 / p95 (all turns)',
        (x) => x,
        (s) => dist(s.latency.complex.scenarioEndToEnd),
      ),
      row('Cost per request', usd, (s) => s.cost.perRequestUsd),
      row(
        'Cost per request p50 / p95',
        (x) => x,
        (s) => microUsd(s.cost.requestCost),
      ),
      row('Cost per direct request', usd, (s) => s.cost.direct.perRequestUsd),
      row('Cost per complex scenario', usd, (s) => s.cost.complex.perScenarioUsd),
      row('Cost per successful task', usd, (s) => s.cost.perSuccessfulTaskUsd),
      row('Total cost', usd, (s) => s.cost.totalUsd),
      row('Model (chat) calls per request', String, (s) => s.cost.modelCallsPerRequest),
      row('Embedding calls per request', String, (s) => s.cost.embeddingCallsPerRequest ?? 0),
      row('Input tokens per request', String, (s) => s.cost.inputTokensPerRequest),
      row('Cached input share', pct, (s) => s.cost.cacheHitRate),
      row('Output tokens per request', String, (s) => s.cost.outputTokensPerRequest),
      row(
        'Retries / failed model calls',
        String,
        (s) => `${s.cost.retries} / ${s.cost.failedModelCalls ?? 0}`,
      ),
    );
    lines.push('', ...tradeoffs(b, o));
  }
  lines.push(
    '## Quality by category (optimized)',
    '',
    '| Category | Scenarios | Task success | Action selection | Param accuracy |',
    '|---|---|---|---|---|',
  );
  for (const [c, q] of Object.entries(o.summary.quality.byCategory))
    lines.push(
      `| ${c} | ${q.scenarios} | ${pct(q.taskSuccess)} | ${pct(q.actionSelection)} | ${pct(q.parameterAccuracy)} |`,
    );
  if (b) {
    lines.push(
      '',
      '## Quality by category (baseline)',
      '',
      '| Category | Scenarios | Task success | Action selection | Param accuracy |',
      '|---|---|---|---|---|',
    );
    for (const [c, q] of Object.entries(b.summary.quality.byCategory))
      lines.push(
        `| ${c} | ${q.scenarios} | ${pct(q.taskSuccess)} | ${pct(q.actionSelection)} | ${pct(q.parameterAccuracy)} |`,
      );
  }
  const st = o.summary.quality.stability;
  if (st)
    lines.push(
      '',
      '## Run-to-run stability (optimized)',
      '',
      `Task success per repeat: ${st.taskSuccessPerRepeat.map(pct).join(', ')} (min ${pct(st.min)}, max ${pct(st.max)}). Scenarios that passed in some repeats and failed in others: ${st.flakyScenarios.length ? st.flakyScenarios.join(', ') : 'none'}.`,
    );
  lines.push('', '## Failures (optimized)', '');
  if (!o.summary.failures.length) lines.push('None.');
  for (const f of o.summary.failures) lines.push(`- **${f.id}** (${f.category}): ${f.failed.join('; ')}`);
  if (b) {
    lines.push('', '## Failures (baseline)', '');
    for (const f of b.summary.failures) lines.push(`- **${f.id}** (${f.category}): ${f.failed.join('; ')}`);
  }
  lines.push(
    '',
    '## Reproduce',
    '',
    '```bash',
    'npm test                 # 500-handler smoke test, executor, agent, HTTP and suite checks (no key)',
    'npm run eval:dataset     # results/eval-dataset.json: every scenario, its turns and expected outcomes',
    'npm run bench            # baseline and optimized on the same scenarios; writes this report',
    'npm run bench:report     # rebuild this report from results/run-*.json without model calls',
    '```',
    '',
    `Scenario coverage: ${report.dataset.modulesCovered}/${report.dataset.modulesTotal} modules. Per-scenario details: \`results/run-optimized.json\`, \`results/run-baseline.json\`. Full execution traces: \`results/traces/<agent>/<scenario>.json\`.`,
  );
  return lines.join('\n');
}

const README = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'README.md');
const README_START = '<!-- BENCHMARK:START -->';
const README_END = '<!-- BENCHMARK:END -->';

/** The short results table embedded in the top-level README (kept in sync by every bench run). */
export function readmeSummary(report) {
  const { optimized: o, baseline: b } = report.runs;
  const cond = o.conditions;
  const lines = [
    `_Generated by \`npm run bench\` on ${report.generatedAt.slice(0, 10)} · ${cond.scenarios} scenarios ×${cond.repeat} · planner \`${cond.models.planner}\` · retrieval \`${cond.retrieval}\` · concurrency ${cond.concurrency} · fixed clock ${cond.fixedNow}. Full report: [\`server/results/BENCHMARK.md\`](server/results/BENCHMARK.md)._`,
    '',
    `| Metric | ${b ? 'Baseline | ' : ''}Optimized | Target | Met? |`,
    `|---|${b ? '---|' : ''}---|---|---|`,
  ];
  const baseTargets = new Map((report.targets.baseline ?? []).map((t) => [t.name, t]));
  for (const t of report.targets.optimized) {
    const bt = baseTargets.get(t.name);
    lines.push(
      `| ${t.name} | ${b ? `${bt?.display ?? '–'} | ` : ''}${t.display} | ${t.targetDisplay} | ${!t.measured ? 'not measured' : t.met ? 'yes' : '**MISSED**'} |`,
    );
  }
  return lines.join('\n');
}

function updateReadme(report) {
  if (!existsSync(README)) return false;
  const text = readFileSync(README, 'utf8');
  const start = text.indexOf(README_START);
  const end = text.indexOf(README_END);
  if (start < 0 || end < start) return false;
  const next = `${text.slice(0, start + README_START.length)}\n${readmeSummary(report)}\n${text.slice(end)}`;
  writeFileSync(README, next);
  return true;
}

export function buildReport(runs, dataset) {
  return {
    generatedAt: new Date().toISOString(),
    dataset: dataset.totals,
    targets: {
      optimized: checkTargets(runs.optimized.summary),
      ...(runs.baseline ? { baseline: checkTargets(runs.baseline.summary) } : {}),
    },
    pricing: pricingTable(),
    models: { planner: config.plannerModel, summary: config.summaryModel, baseline: config.baselineModel },
    runs: Object.fromEntries(
      Object.entries(runs).map(([k, v]) => [k, { conditions: v.conditions, summary: v.summary }]),
    ),
  };
}

const readRun = (name) => {
  const file = path.join(RESULTS_DIR, `run-${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

if (process.argv[1]?.endsWith('bench.js')) {
  const reportOnly = flag('report-only');
  if (!reportOnly && !hasApiKey()) {
    console.error('OPENAI_API_KEY is not set. Copy server/.env.example to server/.env and add your key.');
    process.exit(1);
  }
  const opts = {
    filter: arg('filter'),
    concurrency: Number(arg('concurrency', 4)),
    repeat: Number(arg('repeat', 1)),
  };
  const runs = {};
  if (reportOnly) {
    runs.baseline = readRun('baseline');
    runs.optimized = readRun('optimized');
    if (!runs.optimized) {
      console.error('No results/run-optimized.json yet. Run `npm run bench` first.');
      process.exit(1);
    }
    if (!runs.baseline) delete runs.baseline;
  } else {
    if (!flag('skip-baseline')) runs.baseline = await runEval({ agentName: 'baseline', ...opts });
    else if (readRun('baseline')) runs.baseline = readRun('baseline');
    runs.optimized = await runEval({ agentName: 'optimized', ...opts });
  }
  const dataset = buildDataset(await loadRegistry());
  writeFileSync(path.join(RESULTS_DIR, 'eval-dataset.json'), `${JSON.stringify(dataset, null, 2)}\n`);
  const report = buildReport(runs, dataset);
  writeFileSync(path.join(RESULTS_DIR, 'benchmark-report.json'), JSON.stringify(report, null, 1));
  writeFileSync(path.join(RESULTS_DIR, 'BENCHMARK.md'), `${markdown(report)}\n`);
  const readme = !flag('no-readme') && !opts.filter && updateReadme(report);
  console.log(markdown(report));
  console.log(
    `\nWrote results/BENCHMARK.md and results/benchmark-report.json${readme ? '; updated the results table in README.md' : ''}.`,
  );
}
