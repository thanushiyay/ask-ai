# Results

| File | Produced by | Needs a key |
|---|---|---|
| `eval-dataset.json` | `npm run eval:dataset` (also refreshed by `npm run bench`) — all scenarios with turns, modules, expected actions, parameters and final-state checks | No (already included) |
| `retrieval-bm25.json` | `npm run eval:retrieval` — retrieval recall on the 114 scenarios and the 25 held-out paraphrases | No (already included) |
| `run-optimized.json`, `run-baseline.json` | `npm run eval -- --agent <name>` — per-scenario checks, per-request latency, tokens and cost | Yes |
| `benchmark-report.json`, `BENCHMARK.md` | `npm run bench` — targets met or missed, baseline vs optimized, failures (also refreshes the README results table). `npm run bench:report` rebuilds both from `run-*.json` without a key | Yes (bench) / No (bench:report) |
| `traces/<agent>/<scenario>.json` | eval and bench — full execution traces (every event, model call and action call) | Yes |

The model benchmark needs outbound access to the OpenAI API and a key. Run `npm run bench` (ideally `-- --repeat 3`) locally and commit the generated files, including `traces/`. The report records the test conditions (models, prices, retrieval mode, concurrency, fixed clock, Node version) next to the numbers.
