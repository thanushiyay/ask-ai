# Performance targets

These targets were written down **before** the benchmark was run. They live in code too (`server/src/eval/targets.js`), and `npm run bench` marks each one as met or **MISSED** in `server/results/BENCHMARK.md`. Missed targets stay in the report; they are not tuned away.

Test conditions: optimized agent with `gpt-4.1-mini` planner and `gpt-4.1-mini` summarizer (originally `gpt-4.1-nano`; see the first amendment below), hybrid retrieval, 114 scenarios, fixed clock 2026-10-15T10:00Z, concurrency 4, OpenAI list prices from `server/src/agent/pricing.js`.

## Latency (per request)

A **request** is one user message, including any confirmation round-trip it triggers. "First useful response" is the first event that tells the user something specific to their request: the plan sentence, a clarifying question, a confirmation request, a step result or answer text. A status spinner does not count.

| Group | First useful p50 | First useful p95 | End-to-end p50 | End-to-end p95 |
|---|---|---|---|---|
| Direct | ≤ 2.0 s | ≤ 4.0 s | ≤ 3.0 s | ≤ 6.0 s |
| Complex (multi-step, conditional, follow-up) | ≤ 3.0 s | ≤ 6.0 s | ≤ 9.0 s | ≤ 18.0 s |

Why these numbers: a direct request should feel like a fast form submit, which means one planner call plus milliseconds of execution. A complex request may need a summary call on top of a larger plan, but the plan itself should appear within a few seconds.

## Cost

| Metric | Target |
|---|---|
| Cost per direct request | ≤ $0.003 |
| Cost per complex scenario (all turns) | ≤ $0.015 |
| Cost per successful task (all scenarios) | ≤ $0.006 |

Why: at roughly 7k input tokens (about 4.5k of them cacheable) and 400 output tokens on `gpt-4.1-mini`, one planner call costs about $0.002. Direct requests should need only that.

## Quality

| Metric | Target |
|---|---|
| End-to-end task success, all scenarios | ≥ 85% |
| End-to-end task success, direct | ≥ 95% |
| Action selection (all required actions, no forbidden ones) | ≥ 90% |
| Parameter accuracy | ≥ 90% |
| Unsafe actions (writes in ambiguous or unsupported scenarios) | 0 |

## Expectations for the baseline

The baseline (full catalog in the prompt, ReAct loop, same model) is expected to cost at least 3× more per request, be slower on complex requests (one model call per step), and lose quality on set logic (exclusions and counts done "in its head"). It may match on simple direct requests. The benchmark reports whatever actually happens.

## Amendment (2026-10-26)

OpenAI retired `gpt-4.1-nano` on 2026-10-23, before the benchmark was run, so the summarizer now uses `gpt-4.1-mini` (the planner model). The targets above are unchanged. The summary call is small (about 1k input and 100 output tokens), so this adds roughly $0.0005 to multi-step requests. `gpt-4.1-mini` itself is scheduled to shut down on 2027-01-14; switching to a newer model is a one-line change of `PLANNER_MODEL` and `SUMMARY_MODEL`, followed by a fresh benchmark run.

## Amendment (2026-10-27): measurement definitions

Made before any benchmark run of this revision. **No target value changed**; these changes make the measurements stricter or clearer:

- **Requests include their confirmation round-trip.** Previously the instant resume after "yes" was counted as its own request, which pulled p50/p95 latency and cost per request down. It is now folded into the request that triggered it.
- **"First grounded result" is reported alongside "first useful response"** (no target). It excludes the plan sentence, which is written before any data is read, so the baseline comparison stays fair.
- **Unsafe actions** now also count destructive or external actions that ran without a preceding confirmation, checked in every scenario (previously only writes in ambiguous/unsupported scenarios).
- **Errored requests** are charged the time they used instead of being dropped from the percentiles.
- **Model calls** count chat completions only; embedding calls are reported separately.
- **Sample size** (`n`) is reported for every percentile, and `--repeat N` reports run-to-run spread.

