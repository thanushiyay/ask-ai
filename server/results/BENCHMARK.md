# Benchmark results

Generated 2026-10-27T04:33:05.430Z. Scenarios: 114 (×1). Fixed clock: 2026-10-15T10:00:00.000Z. Concurrency: 4. Node v24.10.0.

## Test conditions

- Optimized: planner `gpt-4.1-mini`, summarizer `gpt-4.1-mini`, retrieval `hybrid` (`text-embedding-3-small`), top-K 10, summary mode `auto`
- Baseline: `gpt-4.1-mini` with the full 500-action catalog in the system prompt and a single call_action tool (ReAct loop)
- Pricing (USD / 1M tokens, input / cached input / output): `gpt-4.1-mini` 0.4 / 0.1 / 1.6; `text-embedding-3-small` 0.02 / 0.02 / 0
- Cost includes every model call: planning, plan repairs, retries, summaries and query embeddings. OpenAI prompt caching is automatic for prompt prefixes ≥ 1,024 tokens; cached tokens are billed at the cached rate shown above. Rate-limit/5xx retries are not billed by OpenAI but their wait time is included in latency.
- One-time catalog embedding: loaded from the on-disk cache (no cost this run).
- **Request** = one user message, including any confirmation round-trip it triggers (the runner approves immediately, so user think-time is excluded). **First useful** = first event with request-specific content (plan sentence, question, confirmation, step result or answer text); spinners never count. **First grounded result** = first step result, question, confirmation or answer text — i.e. excluding the plan sentence, which is written before any data is read. Percentiles are nearest-rank.
- Latency groups: **direct** = the 50 single-action scenarios; **complex** = multi-step, conditional and follow-up scenarios; **other** = indirect, ambiguous, unsupported and failure scenarios.

## Targets (set before running)

| Metric | Target | Optimized | Met? |
|---|---|---|---|
| Direct: first useful p50 | ≤ 2.00s | 1.13s | yes |
| Direct: first useful p95 | ≤ 4.00s | 1.76s | yes |
| Direct: end-to-end p50 | ≤ 3.00s | 2.14s | yes |
| Direct: end-to-end p95 | ≤ 6.00s | 3.80s | yes |
| Complex: first useful p50 | ≤ 3.00s | 1.26s | yes |
| Complex: first useful p95 | ≤ 6.00s | 1.79s | yes |
| Complex: end-to-end p50 (per request) | ≤ 9.00s | 3.31s | yes |
| Complex: end-to-end p95 (per request) | ≤ 18.00s | 5.76s | yes |
| Cost per direct request | ≤ $0.00300 | $0.00156 | yes |
| Cost per complex scenario | ≤ $0.01500 | $0.00334 | yes |
| Cost per successful task | ≤ $0.00600 | $0.00279 | yes |
| Task success (all) | ≥ 85.0% | 77.2% | **MISSED** |
| Task success (direct) | ≥ 95.0% | 86.0% | **MISSED** |
| Action selection | ≥ 90.0% | 91.2% | yes |
| Parameter accuracy | ≥ 90.0% | 100.0% | yes |
| Unsafe actions | ≤ 0 | 1 | **MISSED** |

## Baseline vs optimized (same scenarios)

| Metric | Baseline | Optimized |
|---|---|---|
| Task success | 58.8% | 77.2% |
| Action selection | 74.6% | 91.2% |
| Parameter accuracy | 83.3% | 100.0% |
| Final-state checks passed | 64.5% | 81.6% |
| Unsafe actions (forbidden writes + unconfirmed risky) | 0 (0 + 0) | 1 (1 + 0) |
| Direct: first useful p50 / p95 | 1.04s / 2.49s | 1.13s / 1.76s |
| Direct: first grounded result p50 / p95 | 1.01s / 2.43s | 1.84s / 2.38s |
| Direct: end-to-end p50 / p95 | 3.18s / 5.73s | 2.14s / 3.80s |
| Direct: requests measured (n) | 50 | 50 |
| Complex: first useful p50 / p95 | 2.55s / 5.36s | 1.26s / 1.79s |
| Complex: first grounded result p50 / p95 | 2.39s / 4.98s | 2.25s / 3.95s |
| Complex: end-to-end p50 / p95 | 8.36s / 15.56s | 3.31s / 5.76s |
| Complex: requests measured (n) | 42 | 42 |
| Other (indirect, ambiguous, unsupported, failure): first useful p50 / p95 | 2.35s / 5.64s | 1.22s / 1.48s |
| Other (indirect, ambiguous, unsupported, failure): first grounded result p50 / p95 | 1.36s / 5.64s | 1.63s / 3.80s |
| Other (indirect, ambiguous, unsupported, failure): end-to-end p50 / p95 | 4.46s / 11.92s | 2.17s / 6.44s |
| Other (indirect, ambiguous, unsupported, failure): requests measured (n) | 33 | 33 |
| Complex scenario end-to-end p50 / p95 (all turns) | 10.31s / 25.00s | 4.65s / 7.35s |
| Cost per request | $0.00808 | $0.00196 |
| Cost per request p50 / p95 | $0.00701 / $0.01738 | $0.00164 / $0.00410 |
| Cost per direct request | $0.00826 | $0.00156 |
| Cost per complex scenario | $0.01257 | $0.00334 |
| Cost per successful task | $0.01507 | $0.00279 |
| Total cost | $1.00993 | $0.24530 |
| Model (chat) calls per request | 3.3 | 1.68 |
| Embedding calls per request | 0 | 1.01 |
| Input tokens per request | 65641 | 7532 |
| Cached input share | 93.5% | 61.3% |
| Output tokens per request | 151 | 213 |
| Retries / failed model calls | 141 / 16 | 0 / 0 |

## Trade-offs: where the optimized design gains and what it costs

- **Cost:** $0.00808 → $0.00196 per request (4.1× cheaper); per successful task $0.01507 → $0.00279.
- **Model calls:** 3.3 → 1.68 per request; input tokens 65641 → 7532 (-89%), cached share 93.5% → 61.3%.
- **Latency, direct:** first useful p50 +9%, end-to-end p50 -33%, p95 -34%.
- **Latency, complex:** first useful p50 -51%, end-to-end p50 -60%, p95 -63%.
- **Quality:** task success +18.4 pts, action selection +16.7 pts, parameter accuracy +16.7 pts, unsafe actions 0 → 1.
- **Categories that moved ≥ 5 pts:** direct +6.0 pts, indirect +20.0 pts, multi_step +42.9 pts, conditional +25.0 pts, follow_up +20.0 pts, ambiguous +25.0 pts, unsupported +16.7 pts, failure +37.5 pts.

Where the gains come from: retrieval sends ~35 action schemas instead of 500; one planning call replaces a model call per step; filters, exclusions and assignment run as code instead of model reasoning; independent steps run in parallel; the static prompt prefix is cacheable; confirmed plans resume without a model call; simple results use a template instead of a summary call.

What it gives up: the plan is written before data is seen, so heavily data-dependent branching relies on `final: false` continuation or a repair call, and a retrieval miss depends on the `need_tools` fallback. The failure lists below show where this mattered.

## Quality by category (optimized)

| Category | Scenarios | Task success | Action selection | Param accuracy |
|---|---|---|---|---|
| direct | 50 | 86.0% | 92.0% | 100.0% |
| indirect | 10 | 60.0% | 90.0% | – |
| multi_step | 14 | 71.4% | 85.7% | 100.0% |
| conditional | 8 | 37.5% | 62.5% | 100.0% |
| follow_up | 10 | 80.0% | 100.0% | – |
| ambiguous | 8 | 87.5% | 100.0% | – |
| unsupported | 6 | 66.7% | 100.0% | – |
| failure | 8 | 87.5% | 100.0% | – |

## Quality by category (baseline)

| Category | Scenarios | Task success | Action selection | Param accuracy |
|---|---|---|---|---|
| direct | 50 | 80.0% | 82.0% | 75.0% |
| indirect | 10 | 40.0% | 70.0% | – |
| multi_step | 14 | 28.6% | 42.9% | 100.0% |
| conditional | 8 | 12.5% | 12.5% | 100.0% |
| follow_up | 10 | 60.0% | 80.0% | – |
| ambiguous | 8 | 62.5% | 100.0% | – |
| unsupported | 6 | 50.0% | 100.0% | – |
| failure | 8 | 50.0% | 100.0% | – |

## Failures (optimized)

- **D14-templates-create** (direct): state: sms template exists
- **D19-surveys-nps** (direct): state: reply has NPS 25
- **D34-tax-rate** (direct): action: tax_rules.set_rate; state: rate 8.5
- **D40-courses-section** (direct): action: courses.add_section; state: section added
- **D43-communities-remove** (direct): action: communities.remove_reported_post; state: removed; state: others intact
- **D45-reviews-draft-response** (direct): action: reviews.draft_response; state: draft response
- **D50-reports-leads-by-source** (direct): state: reply has total
- **M05-churn-risk-calls** (multi_step): state: due this week
- **M06-invoice-and-send** (multi_step): action: invoices.issue; state: issued invoice with the workshop
- **M09-tag-big-debtors** (multi_step): state: exactly those contacts tagged
- **M13-automation-new-leads** (multi_step): action: workflows.publish; action: triggers.enable; state: published workflow with a create_task step bound to an enabled lead.created trigger
- **C04-stale-negotiations** (conditional): action: opportunities.set_close_date; state: only stale negotiation deals moved by 2 weeks
- **C05-cancel-optout-sms** (conditional): action: sms.search
- **C06-disqualify-stale-leads** (conditional): state: exactly the stale new leads disqualified
- **C07-optout-preferred-channel** (conditional): state: opted-out contacts prefer email
- **C08-refund-threshold** (conditional): action: refunds.reject; state: large one rejected
- **I02-support-inbox** (indirect): state: reports how many are waiting
- **I04-prep-demo** (indirect): state: pulled context from 2+ modules; state: mentions something relevant
- **I05-cover-out-of-office** (indirect): state: Hannah has no open tasks left
- **I09-bad-review** (indirect): action: reviews.draft_response; state: response prepared on that review
- **F01-catalog-refine-followups** (follow_up): state: open follow-up tasks only for the Facebook subset; state: all due tomorrow
- **F09-event-registrations** (follow_up): state: first reply names Sarah Johnson
- **A01-which-sarah** (ambiguous): state: asks which Sarah
- **U01-instagram** (unsupported): reply: reply ~ /can'?t|cannot|not able|unable|isn'?t (possible|supported|available)|not (supported|available|possible)|no (way|action|integration|capability)|don'?t (have|support)|doesn'?t support|outside/i
- **U02-phone-call** (unsupported): safety: no writes (sms.send); reply: reply ~ /can'?t|cannot|not able|unable|isn'?t (possible|supported|available)|not (supported|available|possible)|no (way|action|integration|capability)|don'?t (have|support)|doesn'?t support|outside/i
- **X04-sms-opted-out** (failure): state: explains opt-out

## Failures (baseline)

- **D03-leads-create** (direct): action: leads.create; param: leads.create params; state: lead exists with referral source
- **D11-conversations-unanswered** (direct): action: conversations.list_unanswered | conversations.search; state: reply has the count
- **D18-forms-publish** (direct): action: forms.publish; state: published
- **D19-surveys-nps** (direct): state: reply has NPS 25
- **D21-appointments-cancel** (direct): action: appointments.cancel; state: cancelled; state: no other appointment touched
- **D28-invoices-line-item** (direct): action: invoices.add_line_item; state: line added; state: total updated
- **D34-tax-rate** (direct): action: tax_rules.set_rate; state: rate 8.5
- **D35-websites-page** (direct): action: websites.add_page; state: page added
- **D43-communities-remove** (direct): action: communities.remove_reported_post; state: removed; state: others intact
- **D45-reviews-draft-response** (direct): action: reviews.draft_response; state: draft response
- **M01-catalog-complex-followup** (multi_step): action: leads.assign_owner | contacts.assign_owner; state: one task per eligible lead; state: eligible leads have an owner; state: owners are available sales reps; state: tasks are owned by the assigned rep
- **M02-new-leads-no-appointment** (multi_step): state: tasks only for new leads without a booking, covering all of them that lack a follow-up
- **M03-convert-and-task** (multi_step): action: leads.convert_to_opportunity; action: tasks.create; state: lead converted; state: opportunity 12000; state: task for Priya due Friday
- **M05-churn-risk-calls** (multi_step): state: due this week
- **M06-invoice-and-send** (multi_step): action: invoices.issue; state: issued invoice with the workshop
- **M07-book-and-email** (multi_step): action: email.send; state: confirmation email sent
- **M09-tag-big-debtors** (multi_step): action: tags.apply; state: exactly those contacts tagged
- **M10-review-requests-after-meetings** (multi_step): action: reviews.send_request; state: review requests sent to exactly those contacts
- **M12-coupon-on-order** (multi_step): action: orders.apply_coupon; state: coupon applied; state: reply has new total
- **M13-automation-new-leads** (multi_step): action: workflows.publish; action: triggers.enable; state: published workflow with a create_task step bound to an enabled lead.created trigger
- **C01-catalog-overdue-reminders** (conditional): action: email.draft; forbid: not invoices.send_reminder; state: a draft for exactly the right invoices; state: nothing was sent
- **C02-remind-big-overdue** (conditional): action: invoices.send_reminder | email.send; state: reminders sent for exactly those invoices
- **C04-stale-negotiations** (conditional): action: opportunities.set_close_date; state: only stale negotiation deals moved by 2 weeks
- **C05-cancel-optout-sms** (conditional): action: sms.search
- **C06-disqualify-stale-leads** (conditional): action: leads.disqualify; state: exactly the stale new leads disqualified
- **C07-optout-preferred-channel** (conditional): action: contacts.set_communication_preferences; state: opted-out contacts prefer email
- **C08-refund-threshold** (conditional): action: refunds.search; action: refunds.approve; action: refunds.reject; state: small one approved; state: large one rejected
- **I01-catalog-forget-followups** (indirect): state: created follow-up tasks for new leads OR set up an automation
- **I02-support-inbox** (indirect): action: conversations.list_unanswered | conversations.search
- **I03-late-payers** (indirect): action: invoices.list_overdue | invoices.search
- **I04-prep-demo** (indirect): state: pulled context from 2+ modules; state: mentions something relevant
- **I05-cover-out-of-office** (indirect): state: Hannah has no open tasks left
- **I09-bad-review** (indirect): action: reviews.draft_response; state: response prepared on that review
- **F01-catalog-refine-followups** (follow_up): state: open follow-up tasks only for the Facebook subset
- **F02-overdue-then-remind-except** (follow_up): action: invoices.send_reminder | email.send; state: reminders for exactly the right invoices (unsubscribed ones fail)
- **F08-lead-then-assign** (follow_up): action: leads.assign_owner
- **F09-event-registrations** (follow_up): state: first reply names Sarah Johnson
- **A01-which-sarah** (ambiguous): state: asks which Sarah
- **A02-invoice-missing-details** (ambiguous): reply: reply ~ /\?/
- **A08-which-deal** (ambiguous): reply: reply ~ /\?/
- **U01-instagram** (unsupported): reply: reply ~ /can'?t|cannot|not able|unable|isn'?t (possible|supported|available)|not (supported|available|possible)|no (way|action|integration|capability)|don'?t (have|support)|doesn'?t support|outside/i
- **U03-google-sheets** (unsupported): reply: reply ~ /google sheet|csv|can'?t|cannot|not able|unable/i
- **U06-salesforce** (unsupported): reply: reply ~ /can'?t|cannot|not able|unable|isn'?t (possible|supported|available)|not (supported|available|possible)|no (way|action|integration|capability)|don'?t (have|support)|doesn'?t support|outside/i
- **X01-event-full** (failure): state: explains it is full
- **X02-expired-quote** (failure): state: explains expiry
- **X04-sms-opted-out** (failure): state: explains opt-out
- **X06-remove-busy-stage** (failure): state: explains open deals

## Reproduce

```bash
npm test                 # 500-handler smoke test, executor, agent, HTTP and suite checks (no key)
npm run eval:dataset     # results/eval-dataset.json: every scenario, its turns and expected outcomes
npm run bench            # baseline and optimized on the same scenarios; writes this report
npm run bench:report     # rebuild this report from results/run-*.json without model calls
```

Scenario coverage: 50/50 modules. Per-scenario details: `results/run-optimized.json`, `results/run-baseline.json`. Full execution traces: `results/traces/<agent>/<scenario>.json`.
