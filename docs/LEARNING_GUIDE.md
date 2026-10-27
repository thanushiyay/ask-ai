# Learning guide: how Ask AI works, one piece at a time

This guide explains the whole project in plain language, in the order a request travels through it. Read it with the code open. Each section names the file to look at, says what it does, explains why it is built that way, and lists questions an interviewer is likely to ask.

---

## 0. The big picture in one paragraph

A user types a sentence. The server finds the ~35 actions (out of 500) that could be relevant. It asks the AI model for a **plan**: a list of steps that use those actions and pass data between them. Plain JavaScript code then runs the plan against a fake but realistic database, pausing to ask the user before anything risky. A short answer is written from what actually happened. Every step is timed and every token is counted, so we can prove speed, cost and correctness.

The model **decides**; our code **does**. The model never touches data directly.

---

## 1. The fake business: data store and clock

**Files:** `server/src/core/store.js`, `server/src/core/clock.js`, `server/src/seed/seed.js`, `server/src/core/world.js`

- **Store:** an in-memory database. Each collection (contacts, invoices…) is an array of records. It can `insert`, `get`, `find`, `update` and `remove`, and it keeps an **audit log** of every change. The UI's Data tab and the test assertions both read that log.
- **Clock:** the app uses the real date, and the seed generates its data relative to it, so "last week" always has the planted leads. Tests and the benchmark pin "now" to a reference date (Thursday 2026-10-15 10:00 UTC); without that, results would change from day to day.
- **Seed:** generates ~107 contacts, 40 leads, 33 invoices, appointments, conversations and data for all 50 modules, using a seeded random generator (same input → identical data). It also **plants** tricky cases on purpose: two Sarahs, a rep who is out this week, invoices overdue by different amounts, reminders already sent this week, a full event, an expired quote.
- **World:** a clock plus a freshly seeded store. The server keeps one; every eval scenario gets its own, so scenarios can run in parallel without interfering.

*Interview questions:* Why do tests use a fixed date while the app uses today? (Reproducible numbers, and a demo that matches the real calendar.) Why one world per scenario? (Isolation and parallel runs.)

---

## 2. The 500 actions: registry, kit and modules

**Files:** `server/src/core/registry.js`, `server/src/core/kit.js`, `server/src/modules/*.js`

An **action** is one thing the platform can do, like "Send invoice reminder". Each action declares:

| Field | Purpose |
|---|---|
| `title`, `description` | What it does. Retrieval and the model read these. |
| `effect` | `read`, `write`, `destructive` or `external`. Decides whether to ask for confirmation. |
| `input` | A **zod** schema (a validation rule set). Bad input is rejected with clear field errors. |
| `output` | A zod schema the result must match. |
| `handler` | The actual JavaScript that reads or changes the store. |

The **registry** loads every module file automatically. Adding a module is just adding a file.

The **kit** has factories for repeated shapes (create, get, search, update, set one field, change status), so 500 actions don't need 500 hand-written boilerplate functions. Domain logic is still written by hand where it matters. Look at `m28-invoices.js` (overdue math, reminders), `m21-appointments.js` with `_scheduling.js` (availability and conflicts), and `m32-orders.js` (stock and coupons).

Handlers **fail honestly**. They throw typed errors (`INVALID_STATE`: "Invoice INV-1060 is paid…") instead of returning fake success.

*Interview questions:* How do you add a module? (Drop a file.) How does the agent know an action is risky? (The `effect` field, not a hardcoded list.) How do you know all 500 work? (The smoke test, section 9.)

---

## 3. Picking tools: retrieval

**Files:** `server/src/agent/retrieval/` (`tool-index.js`, `bm25.js`, `text.js`, `embeddings.js`)

The model can't be shown all 500 actions every time: it is slow, expensive (~22k tokens) and confusing. Retrieval works like a search engine:

- **BM25** is a classic text-search scoring formula. It rewards words that appear in an action's text and are rare across actions. "invoice" is useful; "get" is not.
- **Stemming** turns "invoices", "invoice" and "invoiced" into the same root. **Typo tolerance** maps "invoce" to "invoice".
- **Module scoring:** if the request is clearly about Invoices, include all 10 Invoice actions.
- **Content down-weighting:** in "Add a note: she wants a discount", the note's content should not make Coupons look relevant.
- **Embeddings (optional):** OpenAI turns text into vectors so "earn" can match "revenue" even without shared words. Combined with BM25 using reciprocal rank fusion.
- **Escape hatch:** the model always sees a one-line list of all 50 modules and can ask for more tools (`need_tools`).

Measured: 99.2% of needed actions are retrieved on the scenarios, but **80% on held-out paraphrases**. Be ready to discuss that gap honestly. It shows the BM25 tuning partly fit the test set, and that embeddings plus the escape hatch are the mitigation.

---

## 4. Planning: one model call

**Files:** `server/src/agent/prompts.js`, `server/src/agent/optimized.js` (`callPlanner`)

The planner prompt has a **static** part (rules, plan format, module index), which OpenAI caches automatically so repeat calls are cheaper. It also has a **dynamic** part: the calendar, conversation state, retrieved tools and the request.

The model replies with JSON: a `message` for the user, a `kind` (`execute` / `clarify` / `unsupported` / `answer` / `need_tools`) and the `steps`. Steps reference each other: `"$s1.items[*].contactId"` means "the contactIds from step 1's results".

The message is **streamed**. As soon as the `"message"` field is complete, it is shown, before the rest of the plan arrives. That is the first useful response.

If the JSON is invalid, there is one repair attempt. If a step later fails for a fixable reason, there is one repair call that may only add new steps. The total is capped at 3 model calls.

*Interview questions:* Why plan once instead of step-by-step? (Fewer calls, the model never sees record data, exact set logic in code, independent steps run in parallel.) When does that fail? (When the next step depends on data the model hasn't seen, which `final: false` handles.)

---

## 5. Doing the work: the executor

**Files:** `server/src/agent/execution/` (`executor.js`, `references.js`, `operations.js`, `plan-validation.js`, `repair.js`)

The executor is plain code with no AI. It:

1. Works out which steps depend on which (dependency "waves") and runs ready steps in parallel.
2. Resolves references (`$s3`, `$item.id`, `{{item.name}}`).
3. Runs data operations exactly: `exclude` (remove anyone in this other list), `filter`, `distribute` (round-robin or least-busy assignment), `join` and so on.
4. Runs `foreach` steps once per item, 8 at a time, and records each item's success or failure.
5. **Pauses before risky steps.** Destructive, external, or writes to more than 10 records return a preview to the user. The saved state lets "Confirm" resume without asking the model again.
6. **Asks when unsure.** A lookup marked `expect: "one"` that finds two Sarahs becomes a question with buttons.
7. Marks steps `failed` or `skipped` (when a dependency failed), so the summary can say exactly what happened.

`server/tests/executor.test.js` runs a hand-written plan for the complex and conditional use cases and checks the final data. Start there to understand it.

---

## 6. Remembering the conversation: sessions

**File:** `server/src/agent/session.js`

Replaying the full chat history makes prompts grow every turn. Instead, the planner gets a compact summary: recent turns, the previous plan, **the records it created with their IDs**, data it read, and anything pending (a confirmation or a question).

That is how "Only include the Facebook leads, and make those tasks due tomorrow" works: the planner can see the 6 task IDs it just created and which lead each belongs to, so it cancels 4 and moves 2 to tomorrow.

---

## 7. Answering: the summarizer

**File:** `server/src/agent/summarizer.js`

The answer is built only from what the executor recorded. Simple jobs use a fixed template ("✓ Create contact: Sarah Lee"), which is free and instant. Bigger jobs and questions use the cheapest model with a short fact list, streamed word by word. The prompt forbids inventing anything.

---

## 8. Measuring: traces, cost and latency

**Files:** `server/src/agent/trace.js`, `server/src/agent/pricing.js`, `server/src/agent/llm.js`

Every request gets a trace: each event with a timestamp, each model call (tokens in, cached and out; time; cost; retries) and each action call (arguments, result, time). Cost uses the price table, and cached tokens are cheaper. **First useful** is the time of the first meaningful event. The UI's Trace tab shows all of this live.

---

## 9. Proving it: tests and evaluation

**Files:** `server/tests/*.test.js`, `server/src/eval/*`

- **Smoke test (`npm test`):** calls all 500 actions with valid sample input. Each must succeed and match its schema; writes must change data; reads must not; bad input must not crash.
- **Scenarios (114):** realistic requests in 8 categories. The runner resets the data, plays the conversation (confirming when asked, like a user), then **checks the data**. For example: "exactly one open follow-up task per eligible lead, owned by an available rep". The expected answer is computed from the seed in the assertion, not typed in by hand.
- **Metrics:** p50 and p95 latency (the typical case and the slow 5%), cost per request and per successful task, action-selection and parameter accuracy, and task success by category.
- **Benchmark:** the same scenarios through the **baseline** (all 500 tools in the prompt, step-by-step loop) and the **optimized** agent, compared in one table with every target marked met or missed.
- **Plumbing tests:** a fake OpenAI server returns scripted plans, so the orchestration (confirm/resume, clarify, follow-ups) can be tested without a key or cost.

---

## 10. The chat UI

**Files:** `web/src/App.vue` (layout shell), `web/src/composables/` (`useChat`, `useConversationHistory`), `web/src/lib/chat-events.js` (applies each streamed event), `web/src/components/{layout,chat,details,ui}/`

- **Welcome screen** (`chat/WelcomeScreen.vue`): six starter cards, one per kind of request (simple, goal, multi-step, conditional, question, needs-a-detail).
- **Streaming:** the browser POSTs to `/api/chat` and reads **Server-Sent Events**, a stream of small messages (`plan`, `step_start`, `step_done`, `confirm`, `final`, `done`) that update the screen as they arrive.
- **Steps checklist** (`StepList.vue`): the plan in plain language with a progress bar. Technical action names are hidden behind "Show technical names"; long plans collapse when finished.
- **Confirmation card:** says what will happen, to how many records, and why it needs your OK ("Customers will see this"). Buttons: "Yes, go ahead" / "Cancel". **Clarification chips** let you pick, e.g., which Sarah.
- **Message footer:** status, time, cost and number of actions, plus "View details".
- **Details panel** (`details/DetailsDrawer.vue`, slides in from the right, Esc closes it): Activity (time, cost, every AI call and action), Data (records, with the assistant's changes highlighted), Actions (all 500, plus a box to test which actions a request would use) and Benchmark.
- **Sidebar:** new chat, recent conversations (saved in the browser), and the Smart/Baseline mode switch. Works on phones (the sidebar becomes a slide-out menu) and in dark mode.

## 11. Questions to rehearse

1. Walk me through what happens when I type the complex lead request. (Sections 3 → 7.)
2. Why not give the model all 500 tools? (Tokens, latency, confusion between similar actions. Compare baseline vs optimized numbers.)
3. How do you prevent made-up results? (The model never produces data; the summary only uses executor facts; handlers fail with typed errors; evals check stored state.)
4. How do you handle "send an email to Sarah" when there are two Sarahs? (`expect: "one"` → clarification with candidates.)
5. What happens if the model picks the wrong action? (Validation errors trigger a repair. Evals measure action selection. Retrieval misses are measured too, and `need_tools` is the fallback.)
6. Where is the system weakest? (Held-out retrieval recall; plan-once with data-dependent branching; UTC-only time; in-memory store.)
7. How would you scale to 5,000 actions? (Two-stage retrieval with a vector index and re-ranker, a hierarchical module index, unchanged executor.)
8. What did you trade for speed and cost? (More reliance on one good plan; mitigated by repair calls and `final: false`.)
