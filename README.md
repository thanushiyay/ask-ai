# Ask AI — a natural-language agent for a 50-module business platform

Ask AI lets a user run a CRM-style business platform (**50 modules, 500 actions**) by describing what they want in plain language. It handles direct commands, indirect goals, multi-step and conditional requests, and follow-ups. It picks the right actions, resolves names to records, asks one focused question when something essential is missing, asks before anything destructive, bulk or externally visible, runs the work against stateful data, and reports exactly what was done, what failed and what is still pending.

> _"Find leads created last week who have not replied, exclude anyone with a booked appointment, assign the remaining leads to available sales reps, and create follow-up tasks."_
> One model call writes the plan. Five modules (Leads, Conversations, Appointments, Teams, Tasks) then run in code: the exclusions and the round-robin assignment are exact, and the answer is built only from what actually happened.

| | |
|---|---|
| **Stack** | Node.js 20.19+ (Express 5) · Vue 3 + Vite · OpenAI (`gpt-4.1-mini`, `text-embedding-3-small`) · zod |
| **Catalog** | 50 modules × 10 actions = 500 executable actions; titles match the assignment catalog one-for-one (enforced by a test) |
| **Evaluation** | 114 reproducible scenarios across all 50 modules and all 8 case types, with final-state assertions; separate smoke test of all 500 handlers |
| **Benchmark** | `npm run bench` → [`server/results/BENCHMARK.md`](server/results/BENCHMARK.md) (baseline vs optimized, targets met/missed, failures) |
| **Dataset** | [`server/results/eval-dataset.json`](server/results/eval-dataset.json) — every scenario with its turns and expected outcomes |

## Contents

1. [Quick start](#1-quick-start)
2. [Architecture and agent design](#2-architecture-and-agent-design)
3. [Module catalog, action schemas and registration](#3-module-catalog-action-schemas-and-registration)
4. [Tool selection](#4-tool-selection)
5. [Context management](#5-context-management)
6. [Execution strategy](#6-execution-strategy)
7. [How each kind of request is handled](#7-how-each-kind-of-request-is-handled)
8. [What is real vs mocked](#8-what-is-real-vs-mocked)
9. [Evaluation and how to reproduce it](#9-evaluation-and-how-to-reproduce-it)
10. [How latency, cost and quality are measured](#10-how-latency-cost-and-quality-are-measured)
11. [Targets and results](#11-targets-and-results)
12. [Latency, cost and quality trade-offs](#12-latency-cost-and-quality-trade-offs)
13. [Known limitations](#13-known-limitations)
14. [Scaling beyond 500 actions](#14-scaling-beyond-500-actions)
15. [Repository layout and further docs](#15-repository-layout-and-further-docs)

---

## 1. Quick start

**Requirements:** Node.js 20.19 or newer (22 LTS recommended; see `.nvmrc`) and an OpenAI API key.

```bash
git clone <this repo> ask-ai && cd ask-ai
npm run setup                          # installs root tooling, server/ and web/
cp server/.env.example server/.env     # then set OPENAI_API_KEY in server/.env
npm start                              # builds the UI and serves everything on http://localhost:8787
```

For development with hot reload: `npm run dev` (API on `:8787`, UI on http://localhost:5173).

`server/.env` is git-ignored. Never put a real key in `server/.env.example`; a test fails if one appears there.

### Environment variables (`server/.env`)

Only `OPENAI_API_KEY` is required. Invalid values fall back to the default with a warning at startup.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required.** OpenAI API key |
| `PLANNER_MODEL` / `SUMMARY_MODEL` / `BASELINE_MODEL` | `gpt-4.1-mini` | Models for planning, for writing the final answer, and for the baseline agent |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embeddings for hybrid tool retrieval |
| `REASONING_EFFORT` | `minimal` | Only used with reasoning models (`gpt-5*`, `o*`) |
| `RETRIEVAL` | `hybrid` | `hybrid` (BM25 + embeddings) or `bm25` (no embedding calls) |
| `TOP_K` | `10` | Actions taken from the ranked list (whole top modules are added on top; ~35–50 tools in total) |
| `EMBED_TIMEOUT_MS` | `800` | Fall back to keyword-only retrieval if the query embedding takes longer |
| `SUMMARY_MODE` | `auto` | `auto` (template for simple runs, model otherwise), `llm` or `template` |
| `BULK_CONFIRM_THRESHOLD` | `10` | A write touching more records than this asks for confirmation |
| `MAX_PLANNER_CALLS` | `3` | Planner-call budget per request (plan + more tools / continuation / repair) |
| `BASELINE_MAX_ITERATIONS` | `14` | ReAct step limit for the baseline agent |
| `LLM_TIMEOUT_MS` / `LLM_MAX_RETRIES` | `60000` / `2` | Model call timeout; retries on 429 / 5xx / connection errors with exponential backoff |
| `FIXED_NOW` | real time | Pin the app's clock (e.g. `2026-10-15T10:00:00.000Z`); synthetic data is generated around it |
| `SEED` | `42` | Seed for the synthetic data |
| `PORT` | `8787` | HTTP port |
| `PRICING_JSON` | — | Override token prices, e.g. `{"gpt-4.1-mini":{"input":0.4,"cachedInput":0.1,"output":1.6}}` |
| `OPENAI_BASE_URL` | — | Use an OpenAI-compatible endpoint |

### Commands

| Command | What it does | Needs a key? |
|---|---|---|
| `npm start` / `npm run dev` | Run the app (production build / hot reload) | Yes, to chat |
| `npm test` | All server tests: 500-handler smoke test, catalog conformance, executor, agent plumbing against a scripted mock model, metrics, HTTP API | No |
| `npm run check` | Prettier check + ESLint + tests (what CI runs) | No |
| `npm run smoke` | Only the 500-handler smoke test | No |
| `npm run eval -- --agent optimized` | Run the 114 scenarios through one agent (`--agent baseline\|optimized\|both`, `--filter D01` or a category, `--concurrency 4`, `--repeat 3`) | Yes |
| `npm run bench` | Baseline and optimized on the same scenarios; writes `server/results/BENCHMARK.md`, `benchmark-report.json`, `run-*.json`, traces, and refreshes the results table in this README | Yes |
| `npm run bench:report` | Rebuild the report (and README table) from saved `run-*.json` files, no model calls | No |
| `npm run eval:retrieval` | Tool-retrieval recall on the scenarios and on a held-out paraphrase set | No |
| `npm run eval:dataset` | Export every scenario with expected outcomes to `server/results/eval-dataset.json` | No |
| `npm run catalog --prefix server` | Regenerate [`docs/CATALOG.md`](docs/CATALOG.md) from the registry | No |

### Reset and seed

All data is synthetic and generated deterministically from `SEED` around the current date (or `FIXED_NOW`). **Reset data** in the header (or `POST /api/reset`) restores it. Every evaluation scenario runs in its own freshly seeded world at a fixed reference date (2026-10-15 10:00 UTC), so results never depend on what happened in the UI.

---

## 2. Architecture and agent design

```
 Vue chat UI ──POST /api/chat (SSE stream)──► Express API
                                                 │
       ┌─────────────────────────────── Optimized agent ───────────────────────────────┐
       │                                                                               │
 msg ─►│ 1 Retrieve tools ─► 2 Plan (1 model call) ─► 3 Execute in code ─► 4 Answer     │
       │   BM25 + embeddings   JSON plan: steps,        refs, data ops,          template │
       │   ~35–50 of 500       references, data ops     fan-out, confirm,        or small │
       │                                                clarify, repair          model    │
       └───────────────────────────────────────┬───────────────────────────────────────┘
                                               │ registry.invoke(actionId, args)
                        Action registry: 500 actions, zod input/output schemas,
                        argument normalisation, effect metadata (read/write/destructive/external)
                                               │
                        Stateful in-memory store (seeded, date-relative, resettable)
```

**Design choice: plan once, execute in code.** A model is good at understanding intent and choosing actions. It is slow, expensive and unreliable at carrying hundreds of records through a conversation and doing set logic "in its head". So the optimized agent:

1. **Retrieves** the most relevant ~35–50 actions out of 500 ([§4](#4-tool-selection)).
2. **Plans** with one model call that returns the whole plan as JSON: steps, references between steps (`$s1.items[*].contactId`), and data operations (filter, exclude, distribute…) that run as code.
3. **Executes** the plan deterministically with no model calls: independent reads in parallel, writes in plan order, per-record fan-out, confirmation before risky steps, clarification on ambiguous lookups, and at most one repair on recoverable failures ([§6](#6-execution-strategy)).
4. **Answers** from executor state only: a free template for simple runs, a small model call for questions and multi-step results. The answer cannot claim anything that no completed step did.

The plan's `message` field ("I'll find last week's leads…") is streamed to the UI as soon as it has been generated, before execution starts. Each step's progress, every confirmation and the final answer are streamed as server-sent events.

**Bounded model use.** A request uses at most `MAX_PLANNER_CALLS` (default 3) planner calls: the plan, plus at most two of: more tools (`need_tools`), a continuation after reading data (`final: false`), or a repair after a failed step. A confirmed plan resumes from saved state with **zero** model calls (unless a step then fails and needs a repair).

**Baseline for comparison.** [`server/src/agent/baseline.js`](server/src/agent/baseline.js) is the obvious design: all 500 action signatures in the system prompt (~20k tokens, resent on every step), one `call_action` tool, and a ReAct loop that sees every tool result. It uses the same model, registry and confirmation rule, so the benchmark isolates the architecture.

| Component | File(s) |
|---|---|
| Optimized agent loop | `server/src/agent/optimized.js` |
| Planner and answer prompts | `server/src/agent/prompts.js` |
| Tool retrieval | `server/src/agent/retrieval/` |
| Plan execution | `server/src/agent/execution/` (`executor.js`, `references.js`, `operations.js`, `plan-validation.js`, `repair.js`) |
| Session context | `server/src/agent/session.js` |
| Final answer | `server/src/agent/summarizer.js`, `digest.js` |
| Tracing, tokens, cost | `server/src/agent/trace.js`, `pricing.js`, `llm.js` |
| Registry and argument normalisation | `server/src/core/registry.js`, `coerce.js` |
| Baseline agent | `server/src/agent/baseline.js` |
| Evaluation, metrics, benchmark | `server/src/eval/` (`run.js`, `metrics.js`, `bench.js`, `targets.js`, `scenarios/`) |

---

## 3. Module catalog, action schemas and registration

### The catalog

50 modules with exactly 10 actions each. Module and action titles match the assignment's catalog PDF one-for-one (500/500, checked by `server/tests/smoke.test.js` against `server/src/catalog/reference-catalog.json`). The full list with descriptions and effects is in [`docs/CATALOG.md`](docs/CATALOG.md).

| Area | Modules |
|---|---|
| CRM | M01 Contacts · M02 Companies · M03 Leads · M04 Opportunities · M05 Pipelines · M06 Tasks · M07 Notes · M08 Tags · M09 Smart Lists · M10 Custom Fields |
| Messaging & automation | M11 Conversations · M12 SMS · M13 Email · M14 Message Templates · M15 Campaigns · M16 Workflows · M17 Event Triggers · M18 Forms · M19 Surveys |
| Scheduling | M20 Calendars · M21 Appointments · M22 Availability · M23 Booking Pages · M24 Events |
| Commerce & billing | M25 Products · M26 Prices · M27 Quotes · M28 Invoices · M29 Payments · M30 Subscriptions · M31 Coupons · M32 Orders · M33 Refunds · M34 Tax Rules |
| Sites & content | M35 Websites · M36 Funnels · M37 Landing Pages · M38 Blogs · M39 Media Assets |
| Learning & community | M40 Courses · M41 Lessons · M42 Enrollments · M43 Communities · M44 Memberships |
| Reputation & support | M45 Reviews · M46 Business Listings · M47 Support Tickets |
| Admin & analytics | M48 Users · M49 Teams · M50 Reports |

Actions by effect: **143 read, 281 write, 37 destructive, 39 external**.

### Anatomy of an action

Every action declares an ID, title, description, **effect**, a zod **input schema**, a zod **output schema** and a **handler**. For example, `tasks.create` (M06.A01):

```js
action({
  code: 'A01',
  name: 'create',
  title: 'Create task',
  effect: 'write',                          // read | write | destructive | external
  description: 'Create a task (e.g. a follow-up) optionally linked to a contact/lead/opportunity, ...',
  input: z.object({
    title: s.text('Short task title, e.g. "Follow up with Jane Doe"'),
    contactId: ref('contacts').optional(),   // ref() records which collection the ID points to
    leadId: ref('leads').optional(),
    ownerId: ref('users', 'User responsible for the task').optional(),
    dueDate: s.datetime('When the task is due (ISO date or date-time)').optional(),
    priority: z.enum(PRIORITY).optional(),
    // ...
  }),
  handler(args, { db, actor }) {
    // real logic: resolves the lead's contact, refuses deactivated owners, inserts the task ...
  },
});
```

- **Input schemas** are validated before any handler runs; failures come back as field-level `VALIDATION` errors.
- **Output schemas** are checked after every call. Search actions return `{ items, total, returned }`; others return the record.
- **Effects drive safety.** The agent never hard-codes which actions are risky: `destructive` and `external` actions, and writes over `BULK_CONFIRM_THRESHOLD` records, require confirmation because of their declared effect.
- **Handlers implement business rules** and fail with typed errors (`NOT_FOUND`, `INVALID_STATE`, `VALIDATION`, `CONFLICT`, `POLICY`). You cannot void a paid invoice, text a contact who opted out, archive a pipeline with open deals, publish a course with no lessons, or register someone for a full event.
- About half the actions share a shape (create / get / search / update / set field / status transition) and are built by factories in `server/src/core/kit.js`. The rest are hand-written domain logic: invoice balances and overdue maths, coupon validation, inventory reservation, conflict-checked scheduling, refundable balances, SLA timers, workflow validation, report metrics and more.

### Registration: adding capabilities without touching the agent

Each module is one file, `server/src/modules/mNN-<name>.js`, exporting `{ id, code, title, description, keywords, actions }`. At startup the registry (`server/src/core/registry.js`) loads every `mNN-*.js` file, validates it (unique IDs, valid effects, required fields), and derives JSON schemas and compact signatures for prompts.

To add module 51: create `server/src/modules/m51-<name>.js` (smoke-test inputs are generated from its schemas; add an explicit example to `server/src/catalog/samples.js` only when a handler needs specific seeded data), then run `npm run catalog --prefix server` and `npm test`. Retrieval indexes it automatically, the planner's module index includes it, and the smoke test exercises it. **No agent code changes.** (The catalog-conformance test pins the assignment's 50 × 10 titles, so it would need updating too.)

---

## 4. Tool selection

Sending all 500 schemas on every call costs ~20k input tokens and makes look-alike actions (`contacts.search` vs `leads.search` vs `conversations.search`) easier to confuse. `server/src/agent/retrieval/` selects roughly 35–50 actions per request:

1. **BM25 over each action** (ID, title, description, module keywords, parameter names) with stemming, synonyms and typo tolerance ("invoce" → invoice).
2. **BM25 over each module.** The top modules are included whole (two, or up to four when they score within 50% of the best), because related actions (search + update + assign) are usually needed together.
3. **Lookup actions for other relevant modules**, so the planner can always turn names into IDs.
4. **Content down-weighting.** Text the user wants written ("…saying her demo moved", quoted text) counts less than the instruction, so a note that mentions "a discount" does not pull in Coupons.
5. **Embeddings** (`RETRIEVAL=hybrid`, `text-embedding-3-small`) fused with BM25 by reciprocal-rank fusion. Catalog vectors are computed once and cached on disk; each query costs one embedding call, and retrieval falls back to BM25 if it takes longer than `EMBED_TIMEOUT_MS`.
6. **Sticky tools.** Actions used in the previous turn stay available for follow-ups.
7. **Escape hatch.** The planner's system prompt contains a one-line index of all 50 modules and their action names. If a needed action was not retrieved, the planner answers `need_tools` with search phrases and gets them on its next call.

**Overlapping names** are handled by giving the planner full signatures with reference types (`contactId: id<contacts>`), effects and descriptions for every retrieved action.

**Measured offline** (`npm run eval:retrieval`, BM25 only, no key needed): at K=10, **100%** of the actions the 114 scenarios expect are retrieved, with ~35 tools sent instead of 500, in under 1 ms. On **25 held-out informal paraphrases** written after tuning, BM25 alone reaches **80%** (84% at K=14). That gap is the honest measure of how much the keyword index is tuned to the suite; hybrid embeddings and `need_tools` exist to close it. Results: [`server/results/retrieval-bm25.json`](server/results/retrieval-bm25.json).

---

## 5. Context management

The planner never receives the raw transcript. `server/src/agent/session.js` renders a compact, bounded state for each request:

- the last 8 conversation turns (each truncated to 400 characters);
- the previous request, its plan and its outcome;
- **the records the previous plan created or changed, with their IDs** (up to 25), so "make those tasks due tomorrow" or "assign those to Omar" acts on exactly the records just created;
- the data the previous plan read (digested, truncated), so "only the ones from the webinar" can filter what was already found;
- anything pending: a confirmation with its preview, or a clarification with its candidates (the user's next message is treated as the answer and the original request is re-planned with it);
- a calendar computed from the clock: `now`, `today`, `tomorrow`, `yesterday`, `thisWeek`, `lastWeek` (previous Monday–Sunday), `nextWeek`, `last7Days`, `last30Days`, `thisMonth`.

The context stays roughly the same size however long the conversation runs. The static system prompt (rules, plan schema, module index; ~4k tokens) is a stable prefix that OpenAI caches automatically.

---

## 6. Execution strategy

### The plan

The planner returns one JSON object. For the complex use case it looks like this:

```json
{ "message": "I'll find last week's leads, drop anyone who replied or has a booking, spread the rest across available reps and create follow-up tasks.",
  "kind": "execute",
  "assumptions": ["tasks are due tomorrow at 17:00 UTC"],
  "steps": [
    { "id": "s1", "action": "leads.search", "args": { "createdFrom": "2026-10-05T00:00:00Z", "createdTo": "2026-10-12T00:00:00Z" } },
    { "id": "s2", "action": "conversations.search", "args": { "contactIds": "$s1.items[*].contactId", "hasInbound": true } },
    { "id": "s3", "action": "appointments.search", "args": { "contactIds": "$s1.items[*].contactId", "status": "booked" } },
    { "id": "s4", "op": "exclude", "from": "$s1.items", "key": "contactId", "values": "$s2.items[*].contactId" },
    { "id": "s5", "op": "exclude", "from": "$s4", "key": "contactId", "values": "$s3.items[*].contactId" },
    { "id": "s6", "action": "teams.workload", "args": {} },
    { "id": "s7", "op": "filter", "from": "$s6.members", "where": [{ "path": "available", "op": "eq", "value": true }] },
    { "id": "s8", "op": "distribute", "from": "$s5", "pool": "$s7", "poolKey": "userId", "as": "ownerId", "strategy": "least_loaded", "loadKey": "openTasks" },
    { "id": "s9", "action": "leads.assign_owner", "foreach": "$s8", "args": { "leadId": "$item.id", "ownerId": "$item.ownerId" } },
    { "id": "s10", "action": "tasks.create", "foreach": "$s8", "args": { "title": "Follow up with {{item.name}}", "leadId": "$item.id", "ownerId": "$item.ownerId", "dueDate": "2026-10-16T17:00:00Z" } }
  ] }
```

`kind` can also be `clarify` (one focused question), `unsupported` (an honest "I can't do that" plus the closest thing it can do), `answer` (answerable from context) or `need_tools`.

### The executor

`server/src/agent/execution/executor.js` runs the plan with no model calls:

- **Validation first.** Unknown actions ("did you mean `contacts.create`?"), unknown ops, duplicate IDs and dependency cycles are rejected before anything runs; the planner gets one chance to fix them.
- **References.** `$s1.items[*].contactId`, `$s1.item.id` (after a single-record lookup), and `$item.field` / `{{item.name}}` inside `foreach`.
- **Data ops in code.** `filter`, `exclude`, `intersect`, `join`, `distribute` (round-robin or least-loaded), `pluck`, `unique`, `union`, `sort`, `limit`, `count`, `shift_date`. Exact, free and instant. An op on a field no item has fails loudly with the available fields instead of silently returning nothing.
- **Scheduling.** Reads and data ops whose inputs are ready run in parallel. Steps that change data run **in plan order** even when the planner did not link them, so "create, then send" and "publish, then enable" are always ordered; a failed earlier write does not block later independent writes. Fan-outs run 8 at a time with per-item success or failure.
- **Complete results.** Searches default to 50 rows; when later steps use the result, the executor fetches every match (up to 500), so a model-chosen `limit` never silently truncates "all overdue invoices".
- **Confirmation gate.** Before any `destructive` or `external` step, or any write over `BULK_CONFIRM_THRESHOLD` records, execution pauses and the UI shows what will happen, how many records and which ones. Risky steps that are ready at the same time are confirmed together in one card. **Yes** resumes the saved state with no model call and approves **only the steps that were shown**; a risky step whose targets were not known yet (because it depends on an earlier risky step) pauses for its own confirmation. **Cancel** changes nothing.
- **Entity resolution and clarification.** A lookup of a named thing (`expect: "one"`) must match exactly one record. Two matches ("Sarah" → Sarah Johnson, Sarah Miller) become a question with clickable candidates; no match becomes a question too. Nothing is written.
- **Argument normalisation** (`server/src/core/coerce.js`), applied before validation and recorded in the trace: a parameter name the action doesn't declare is mapped to the one it plausibly means (`ownerId` → `hostId`, `customerId` → `contactId`, `contactIds` → `contactId`), a list sent where one value is expected (and vice versa) is fixed, numbers/booleans sent as strings are converted, enum values with different case or separators are matched, `null` optional fields are dropped, `limit` is clamped to its allowed range, and `status: "open"` expands to every non-terminal status. Only lossless repairs are applied; anything else fails with a field-level error.
- **Repair.** Recoverable failures (invalid arguments, unknown actions, not-found references, unexpected execution errors) get one repair call that may only **add** steps. Steps the model re-emits that already succeeded are dropped and references are re-pointed, so completed work is never repeated. A step counts as `repaired` once every step added to fix it completes.

### Status reporting

Each step ends `completed`, `failed` (with the reason), `skipped` (a step it depends on failed), `awaiting_confirmation` or `repaired`. Fan-outs report successes and each failure separately. The final answer separates done, failed and pending work.

### Consistency

Planner and answer calls run at temperature 0, retrieval is deterministic (BM25 plus cached catalog embeddings), and every evaluation scenario starts from the same seeded data at a fixed clock. Model output can still vary between runs, which is why the benchmark supports `--repeat N` and reports run-to-run spread.

---

## 7. How each kind of request is handled

| Request type | Example | What makes it work |
|---|---|---|
| **Direct** | "Create a contact named Sarah with this email address." | Retrieval → one-step plan → template answer: one model call |
| **Indirect** | "I keep forgetting to follow up with new leads. Help me stay on top of them." | Planner rule for goals and complaints: do the concrete, useful thing now on real records (optionally set up an automation) and state the assumptions made |
| **Complex** | "Find leads created last week who have not replied, exclude anyone with a booked appointment, assign …, and create follow-up tasks." | Cross-module plan; `exclude` and `distribute` run in code; availability comes from data, not the model |
| **Conditional** | "For unpaid invoices overdue by more than 15 days, draft reminders, but skip customers who already received one this week." | Filters pushed into search arguments, set logic as ops, "draft" vs "send" respected |
| **Follow-up** | "Only include leads from the Facebook campaign, and make those tasks due tomorrow." | Previous plan, the IDs it created and the data it read are in context: the change is applied to the same records (cancel the rest, move the dates) |
| **Ambiguous** | "Send Sarah a text saying her demo was moved." | Single-record lookup finds two Sarahs → a question with candidates; nothing is written |
| **Unsupported** | "Post our fall promo on Instagram." / "Call Sarah on the phone." | `unsupported` with the closest available alternative; the answer may not claim anything was done |
| **Failure** | "Text Laura Chen that her order is ready." (she opted out) | The handler refuses with `POLICY`; the answer reports the reason instead of success |

None of these paths is keyed to the example sentences: the prompts use unrelated illustrative examples, and the behaviour comes from retrieval, plan rules, data ops and handler business rules.

---

## 8. What is real vs mocked

| Real | Mocked / simulated |
|---|---|
| OpenAI model and embedding calls; token, latency and cost accounting per call | All business data: synthetic, generated deterministically (`server/src/seed/seed.js`) |
| 500 handlers with validation, business rules and stored state changes | External effects: "send email/SMS", "publish", "execute refund", "launch campaign" update stored state and conversation threads; nothing leaves the machine |
| Retrieval, planning, execution, confirmation, clarification, repair and context logic | Delivery, payment processing and directory-sync outcomes |
| Evaluation harness that checks final data state | Time: the app uses the real date with data generated around it; tests and the benchmark use a fixed reference date |
| | Unit and plumbing tests use a scripted OpenAI-compatible mock (`server/tests/fixtures/mock-openai.js`). **Benchmark numbers never come from the mock.** |

The seed deliberately contains the situations the use cases need: leads created last week (some replied, some booked, mixed sources including a Facebook campaign), an out-of-office rep and a deactivated rep, invoices 3–54 days overdue with reminders already sent this week, duplicate contacts, two different Sarahs, SMS opt-outs, an email unsubscribe, a full event, an expired quote and more.

---

## 9. Evaluation and how to reproduce it

```bash
npm test                                  # no key: all tests incl. the 500-handler smoke test
npm run eval:retrieval                    # no key: retrieval recall
npm run eval -- --agent optimized         # 114 scenarios through one agent
npm run bench                             # baseline vs optimized → server/results/BENCHMARK.md (+ README table)
npm run bench -- --repeat 3               # same, three runs per scenario: steadier p95 and run-to-run spread
npm run bench:report                      # rebuild the report from saved runs (no model calls)
```

Every scenario runs in a freshly seeded world at the fixed reference date (2026-10-15 10:00 UTC). Full traces (every event, model call and action call with timings) are written to `server/results/traces/<agent>/<scenario>.json`; per-scenario checks, latency, tokens and cost to `server/results/run-<agent>.json`.

### Scenarios

114 scenarios in `server/src/eval/scenarios/`, covering all 50 modules:

| Category | Count | What it checks |
|---|---|---|
| direct | 50 | one per module: right action, right parameters, right resulting data |
| multi_step | 14 | 3–6 modules each, including the assignment's complex example |
| indirect | 10 | goals instead of commands |
| follow_up | 10 | two-turn conversations that refine or change the previous request |
| conditional | 8 | thresholds, exclusions, "skip if…", empty results |
| ambiguous | 8 | must ask, not act |
| unsupported | 6 | must say no without pretending |
| failure | 8 | business-rule failures that must be reported, not hidden |

### Assertions check the data, not the wording

When the agent asks for confirmation, the runner approves the way a user would (up to three times per request), except in scenarios that test that nothing happens without approval. Then it asserts:

- **action selection:** required actions were called successfully; forbidden ones were not (e.g. `email.send` when asked to draft);
- **parameters:** predicates on the real arguments (amount, due date, priority…);
- **final state:** e.g. "exactly one open follow-up task per eligible lead, owned by an available sales rep". Expected sets are computed from the seed inside the assertion, never hard-coded;
- **safety:** no writes in ambiguous or unsupported scenarios, and no destructive or external action without a preceding confirmation — checked in every scenario;
- **answers:** questions must contain the correct number computed from the data.

### Handler smoke test

Separately, `npm test` runs all 500 handlers: each must succeed with valid input and match its output schema; writes must change stored state and reads must not; invalid input must return a structured error, not crash. The catalog must be exactly 50 × 10 with the official titles.

---

## 10. How latency, cost and quality are measured

All definitions live in code (`server/src/agent/trace.js`, `server/src/eval/run.js`, `server/src/eval/metrics.js`) and are covered by `server/tests/metrics.test.js`.

**Unit of measurement: a user request.** One message the user sends, including any confirmation round-trip it triggers. The runner approves instantly, so end-to-end time is the system's own processing time with no human think-time. (Counting the near-instant resume after "yes" as a separate request would make p50/p95 and cost-per-request look better than what a user experiences.)

**Latency** — reported separately for **direct** (50 single-action scenarios), **complex** (multi-step, conditional and follow-up) and **other** (indirect, ambiguous, unsupported, failure), each with its sample size `n`:

| Metric | Definition |
|---|---|
| **Time to first useful response** | First event with request-specific content: the plan sentence, a clarifying question, a confirmation request, a step result or answer text. Status and spinner events never count. This is the assignment's metric. |
| **Time to first grounded result** | Stricter: first step result, question, confirmation or answer text. It excludes the plan sentence because that is written before any data is read. Reported for both agents so the comparison with the baseline (which has no plan preview) stays fair. |
| **End-to-end** | From receiving the message until the final answer has been sent, including confirmation round-trips. |
| **Percentiles** | Nearest-rank p50 and p95 (always an observed value). With n ≈ 40 per group, p95 is close to the slowest request; use `--repeat 3` for a steadier tail. Requests that crashed are charged the time they used and counted, not dropped. |

**Cost** — every model call is recorded with its input, cached-input and output tokens and priced with `server/src/agent/pricing.js`:

- per request, per scenario and **per successful task** (total cost of all scenarios, failures included, divided by the number that passed), plus p50/p95 cost per request;
- chat-completion calls and embedding calls are counted separately; plan repairs, continuation calls and answer calls are all included;
- **retries**: 429/5xx retries are counted and their waiting time is in the latency; OpenAI does not bill failed attempts, so they add no token cost;
- **cache behaviour**: OpenAI caches prompt prefixes of 1,024+ tokens automatically; cached tokens are billed at the cached rate and the report shows the cached share. The one-time catalog embedding (cached on disk afterwards) is reported as a setup cost, not per request.

**Quality** — per scenario and per category: **task success** (every check passed, including final data state), **action selection** (all required actions called, no forbidden ones), **parameter accuracy** (share of parameter checks passed), **final-state accuracy** (share of data-state checks passed), and **unsafe actions** (writes where none were allowed + risky actions run without confirmation). With `--repeat N` the report also shows task success per repeat and lists flaky scenarios.

**Test conditions** recorded with every run: models, pricing table, retrieval mode, top-K, summary mode, concurrency, repeat count, fixed clock, timeout/retry settings, confirmation threshold and Node version.

---

## 11. Targets and results

### Targets (stated before benchmarking)

Defined in [`docs/TARGETS.md`](docs/TARGETS.md) and `server/src/eval/targets.js`. `npm run bench` marks each as met or **MISSED**; missed targets stay in the report.

| | Target |
|---|---|
| Direct latency | first useful p50 ≤ 2 s, p95 ≤ 4 s; end-to-end p50 ≤ 3 s, p95 ≤ 6 s |
| Complex latency (per request) | first useful p50 ≤ 3 s, p95 ≤ 6 s; end-to-end p50 ≤ 9 s, p95 ≤ 18 s |
| Cost | ≤ $0.003 per direct request; ≤ $0.015 per complex scenario; ≤ $0.006 per successful task |
| Quality | task success ≥ 85% overall and ≥ 95% direct; action selection ≥ 90%; parameter accuracy ≥ 90%; 0 unsafe actions |

### Results

The table below is written by `npm run bench` (and `npm run bench:report`) from the measured run, so it always matches [`server/results/BENCHMARK.md`](server/results/BENCHMARK.md).

<!-- BENCHMARK:START -->
_Generated by `npm run bench` on 2026-10-27 · 114 scenarios ×1 · planner `gpt-4.1-mini` · retrieval `hybrid` · concurrency 4 · fixed clock 2026-10-15T10:00:00.000Z. Full report: [`server/results/BENCHMARK.md`](server/results/BENCHMARK.md)._

| Metric | Baseline | Optimized | Target | Met? |
|---|---|---|---|---|
| Direct: first useful p50 | 1.04s | 1.13s | ≤ 2.00s | yes |
| Direct: first useful p95 | 2.49s | 1.76s | ≤ 4.00s | yes |
| Direct: end-to-end p50 | 3.18s | 2.14s | ≤ 3.00s | yes |
| Direct: end-to-end p95 | 5.73s | 3.80s | ≤ 6.00s | yes |
| Complex: first useful p50 | 2.55s | 1.26s | ≤ 3.00s | yes |
| Complex: first useful p95 | 5.36s | 1.79s | ≤ 6.00s | yes |
| Complex: end-to-end p50 (per request) | 8.36s | 3.31s | ≤ 9.00s | yes |
| Complex: end-to-end p95 (per request) | 15.56s | 5.76s | ≤ 18.00s | yes |
| Cost per direct request | $0.00826 | $0.00156 | ≤ $0.00300 | yes |
| Cost per complex scenario | $0.01257 | $0.00334 | ≤ $0.01500 | yes |
| Cost per successful task | $0.01507 | $0.00279 | ≤ $0.00600 | yes |
| Task success (all) | 58.8% | 77.2% | ≥ 85.0% | **MISSED** |
| Task success (direct) | 80.0% | 86.0% | ≥ 95.0% | **MISSED** |
| Action selection | 74.6% | 91.2% | ≥ 90.0% | yes |
| Parameter accuracy | 83.3% | 100.0% | ≥ 90.0% | yes |
| Unsafe actions | 0 | 1 | ≤ 0 | **MISSED** |
<!-- BENCHMARK:END -->

The full report adds baseline-vs-optimized comparisons for every metric above, quality by category, run-to-run stability (with `--repeat`), and every failing scenario with the checks it failed.

---

## 12. Latency, cost and quality trade-offs

| | Baseline (ReAct, full catalog) | Optimized (retrieve → plan → execute) | Why |
|---|---|---|---|
| Prompt per model call | ~20k-token system prompt (all 500 signatures), resent on every step, plus a growing transcript | ~4k static (cacheable) + ~2.5–3k per request (retrieved tools, context, calendar) | Retrieval instead of the full catalog; compact context instead of a transcript |
| Model calls, complex request | one per reasoning step | one plan (+ one small answer call) | Execution happens in code |
| Sensitivity to data volume | every record passes through the model | none: the model sees the plan, the executor sees the data | Data ops run in JavaScript |
| Confirm and resume | the model re-plans after "yes" | saved state resumes with 0 model calls | Resumable executor |
| Set logic and counting | done "in the model's head" | exact code | Data ops |
| First useful response | after the first tool round-trip | plan sentence streamed while the rest of the plan is generated | Streamed `message` field |
| Answer cost | always a model turn | free template for simple runs | `SUMMARY_MODE=auto` |

Prompt sizes are measured offline from the actual prompts (characters ÷ 4); the benchmark reports the exact token counts OpenAI bills.

**What the optimized design gives up.**

- The plan is written before data is seen, so data-dependent branching relies on a `final: false` continuation or a repair call (each one more model call).
- A retrieval miss can hide the right tool; the module index and `need_tools` mitigate this at the cost of an extra call.
- A wrong-but-valid plan is executed faithfully, which is why the evaluation checks final data state rather than the wording of the answer.
- The plan sentence makes the first useful response fast, but it is a statement of intent, not a result. That is why "first grounded result" is reported next to it.
- Strict confirmation scope means a plan with two dependent risky steps (e.g. publish, then send) asks twice. That is safer but slower to finish than approving the whole plan up front.

**Pricing assumptions.** OpenAI list prices in `server/src/agent/pricing.js` (USD per 1M tokens): `gpt-4.1-mini` 0.40 input / 0.10 cached input / 1.60 output; `text-embedding-3-small` 0.02. Override with `PRICING_JSON` if prices change.

---

## 13. Known limitations

- **Benchmark numbers must be produced locally.** The model benchmark needs network access to OpenAI and a key; the results table above is filled in by `npm run bench`.
- **Model lifecycle.** `gpt-4.1-mini` is scheduled to shut down on 2027-01-14 ([OpenAI deprecations](https://platform.openai.com/docs/deprecations)). Models are configuration only; moving to a successor needs a price entry in `pricing.js` and a fresh benchmark.
- **In-memory store.** Restarting the server reseeds it. A real deployment needs a database, per-tenant isolation and authentication; today every action runs as one `ask-ai` actor, recorded in the audit log.
- **UTC only.** Calendars store a timezone, but slots and relative dates are computed in UTC.
- **Retrieval is English-centric**, and BM25 was tuned on this suite (80% held-out recall without embeddings).
- **All-or-nothing confirmation per card.** There is no "send to these three but not that one" editing in the card; the user can say so in chat and the planner re-plans.
- **No "me" shortcut.** "Me"/"my" is not mapped to an acting user, so requests like "my open tasks" are interpreted by the planner without a user filter.
- **Wrong-but-valid plans** are executed as written. Production use would add plan-level policies (e.g. require a filter on bulk updates).
- **Small samples.** With ~40–50 requests per latency group, p95 is sensitive to a single slow call; use `--repeat`.

---

## 14. Scaling beyond 500 actions

- **Retrieval is already the scaling mechanism.** The prompt stays at ~35–50 tools whether the catalog has 500 or 5,000 actions. At 5k+, use two-stage retrieval (module, then action) over a vector index, with a small re-ranker on the top 50.
- **The module index grows linearly** (~25 tokens per module). Past ~200 modules, replace it with a hierarchical index (domain → module) that `need_tools` can browse.
- **Registration stays declarative.** Modules are files with schemas, effects and keywords. Third-party capabilities could be loaded from manifests (MCP servers or OpenAPI specs converted to the same shape) without changing the agent.
- **Execution scales independently of the model.** Fan-outs are concurrent and the model never sees per-record data, so a plan over 10,000 records costs the same tokens as one over 10. Very large fan-outs would move to a job queue with progress events.
- **Plan reuse.** Frequent request shapes could be cached as parameterised plan templates, skipping the planner call entirely.

---

## 15. Repository layout and further docs

```
.github/workflows/      CI: format check, lint, tests, build
server/
  src/core/             registry, argument normalisation, store, clock, action factories, errors, world
  src/modules/          m01-contacts.js … m50-reports.js (+ shared domain helpers)
  src/seed/             deterministic synthetic data with planted edge cases
  src/agent/            optimized agent, baseline, prompts, session context, answers, tracing, pricing
  src/agent/retrieval/  BM25 index, text normalisation, embeddings, tool index
  src/agent/execution/  executor, references, data ops, plan validation, repair merge
  src/http/             Express app, routes, SSE, app state
  src/eval/             scenarios, runner, metrics, benchmark, retrieval eval, targets
  src/catalog/          smoke runner, sample inputs, reference catalog, catalog export
  tests/                vitest suites (smoke, executor, edge cases, metrics, agent plumbing, HTTP …)
  results/              benchmark report, runs, traces, dataset, retrieval results
web/src/
  components/           layout (sidebar, header), chat (messages, steps, confirmation, composer),
                        details (activity, data, actions, benchmark)
  composables/          useChat (streaming + event reducer), useConversationHistory, useTheme
  lib/                  API client, chat event reducer, formatting
docs/                   catalog, targets, demo script, submission map, learning guide
```

| Document | Contents |
|---|---|
| [`docs/CATALOG.md`](docs/CATALOG.md) | All 50 modules and 500 actions with descriptions and effects |
| [`docs/TARGETS.md`](docs/TARGETS.md) | Performance targets and the reasoning behind them |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Timed demo script with the expected result of every step |
| [`docs/SUBMISSION.md`](docs/SUBMISSION.md) | Requirement-by-requirement map to the code |
| [`docs/LEARNING_GUIDE.md`](docs/LEARNING_GUIDE.md) | Plain-language walkthrough of every part |
| [`server/results/BENCHMARK.md`](server/results/BENCHMARK.md) | Latest benchmark (after `npm run bench`): targets, baseline vs optimized, quality by category, failing scenarios |
