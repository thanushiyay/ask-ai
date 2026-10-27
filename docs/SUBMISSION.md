# Submission guide

This page maps every requirement in the assignment brief to where it is met, then lists the steps to produce the final submission.

## Requirement traceability

### Setup

| Requirement | Where |
|---|---|
| Node.js backend | `server/` (Express 5, ES modules) |
| Vue.js chat interface | `web/` (Vue 3 + Vite) |
| LLM provider | OpenAI: `server/src/agent/llm.js`, models configurable in `server/.env` |
| 50 modules × exactly 10 actions | `server/src/modules/m01-…m50-*.js`; enforced by `server/tests/smoke.test.js`; listed in [CATALOG.md](CATALOG.md) |
| Executable, stateful handlers for all 500 | Handlers read and change the in-memory store and fail with typed errors (`server/src/core/store.js`, `errors.js`) |
| Synthetic data, reproducible reset/seed | `server/src/seed/seed.js` (seed 42, fixed clock); `POST /api/reset` and the Reset data button |
| Extensible registration | `server/src/core/registry.js` loads every module file; no agent changes needed to add one |

### Core features

| Requirement | Where |
|---|---|
| Multi-turn conversations, follow-ups, context | `server/src/agent/session.js` (recent turns, last plan, written record IDs, pending state) |
| Useful progress while running | Server-Sent Events (`server/src/http/routes/chat.js`) rendered by `web/src/components/chat/StepList.vue` |
| Final answer grounded in execution | `server/src/agent/summarizer.js` uses executor facts only |
| Searchable catalog of 500 actions | `GET /api/catalog`, `POST /api/catalog/search`, Details → Actions tab |
| Name, description, input/output schema, handler per action | `action()` in `server/src/core/kit.js`; zod schemas exported as JSON Schema |
| Overlapping names, similar functionality | BM25 + synonyms + module scoring + optional embeddings (`server/src/agent/retrieval/`) |
| Entity resolution and parameter validation | `expect: "one"` lookups and clarification (`server/src/agent/execution/executor.js`); zod validation before every handler |
| No hardcoded mappings from example prompts | Retrieval and planning are generic; held-out paraphrase recall is reported |
| Typos, paraphrases, indirect requests | Typo-tolerant retrieval; planner rules for indirect intent; `indirect` scenarios |
| Dependencies, filters, exclusions, conditions | Plan references and data ops (`filter`, `exclude`, `distribute`, `join`…) in `server/src/agent/execution/operations.js` |
| Clarify without repeating known information | Session context in the planner prompt; clarification options built from data |
| Honest unsupported handling | `kind: "unsupported"` plan; `unsupported` and `failure` scenarios assert no writes |
| Read, search, create, update; combine modules | All four effects across 50 modules; multi-module scenarios |

### Latency, cost and quality

| Requirement | Where |
|---|---|
| p50/p95 first useful response and end-to-end, direct vs complex | `server/src/eval/metrics.js`; `BENCHMARK.md` |
| Tokens, model calls, cost per request and per successful task, incl. retries | `server/src/agent/trace.js`, `pricing.js`; `BENCHMARK.md` |
| Model, pricing assumptions, cache behaviour, test conditions | "Test conditions" section of `BENCHMARK.md` |
| Action selection, parameter accuracy, task success on final data state | `server/src/eval/run.js`, `helpers.js` |
| ≥ 100 reproducible scenarios across all 50 modules and all case types | 114 scenarios, 50/50 modules; `server/results/eval-dataset.json`; enforced by `server/tests/evaluation.test.js` |
| Smoke test of all 500 handlers | `npm test` (`server/tests/smoke.test.js`) |
| Baseline vs optimized on the same scenarios, with trade-offs | `server/src/agent/baseline.js`; "Trade-offs" section of `BENCHMARK.md` |
| Targets stated before running; failures reported | [TARGETS.md](TARGETS.md), `server/src/eval/targets.js`; MISSED rows and failure lists in `BENCHMARK.md` |

### README contents

Architecture, catalog and registration, tool selection, context management, execution strategy, real vs mocked, how to run and reproduce evaluations, trade-offs, known limitations and scaling: all in the root [README.md](../README.md).

## Steps to submit

1. **Verify locally (no key needed)**

   ```bash
   npm run setup
   npm run check          # formatting, lint, all tests
   ```

2. **Run the benchmark with your key**

   ```bash
   npm run bench -- --repeat 3   # ~114 × 3 scenarios per agent; writes server/results/BENCHMARK.md,
                                 # benchmark-report.json, run-*.json, traces/ and the README results table
   ```

   `--repeat 3` gives each latency group ~120–150 requests, so p95 is not just the single slowest call, and shows run-to-run spread. It costs roughly three times a single run. Read `BENCHMARK.md` fully. Keep missed targets and failures in the report: the brief asks for them. The README results table is refreshed automatically; add two or three sentences under it interpreting the headline numbers (where the optimized agent wins, what it costs in quality).

   Commit `server/results/` (including `traces/`) so reviewers can inspect the runs without a key.

3. **Record the demo (2–5 minutes)** following [DEMO_SCRIPT.md](DEMO_SCRIPT.md). It covers every item the brief lists: direct, indirect, a workflow across three or more modules, a follow-up that changes the previous request, an ambiguity or tool failure, and the benchmark results. Upload it (YouTube unlisted, Loom or Google Drive with link access) and add the link at the top of the README.

4. **Publish to GitHub**

   ```bash
   git init
   git add .
   git status             # confirm server/.env is NOT listed
   git commit -m "Ask AI framework: agent, 500-action catalog, evaluation suite and benchmark"
   git branch -M main
   git remote add origin https://github.com/<your-username>/ask-ai.git
   git push -u origin main
   ```

   Create the empty repository on GitHub first (no README or .gitignore, since the project has both). The CI workflow runs on the first push; check the Actions tab is green.

5. **Send:** the repository URL, the demo video link, and a note that the benchmark report is at `server/results/BENCHMARK.md` and the evaluation dataset at `server/results/eval-dataset.json`.

## Final checklist

- [ ] `npm run check` passes
- [ ] `server/results/BENCHMARK.md` generated with your key and committed
- [ ] `server/results/eval-dataset.json`, `run-*.json` and `traces/` committed
- [ ] README links the demo video and summarises the benchmark
- [ ] `server/.env` is not in the repository
- [ ] CI is green on GitHub
