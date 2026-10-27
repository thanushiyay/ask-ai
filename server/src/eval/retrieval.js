import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadRegistry } from '../core/registry.js';
import { ToolIndex } from '../agent/retrieval/index.js';
import { scenarios } from './scenarios/index.js';
import { RESULTS_DIR } from './run.js';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};

// Held-out paraphrases, never used while tuning retrieval.
export const HOLDOUT = [
  ['pls make a new contact for jon doe jon@x.com', ['contacts.create']],
  ['whats still owed on invoce INV-1043', ['invoices.get', 'invoices.search']],
  ['shoot a text to Leo saying hi', ['sms.send']],
  ["move Lucas's deal to the proposal stage", ['opportunities.move_stage']],
  [
    "who's free thursday afternoon among the reps",
    ['availability.find_slots', 'teams.workload', 'users.list'],
  ],
  ['kill the summer coupon', ['coupons.deactivate']],
  ['give julian his $20 back', ['refunds.create', 'refunds.execute']],
  ['put Emma on the meetup waitlist', ['events.add_to_waitlist']],
  ['how are our google reviews looking', ['reviews.rating_summary', 'reviews.search']],
  ['get rid of the old banner image', ['media.delete_unreferenced']],
  ['turn the webinar nurture back on', ['campaigns.resume']],
  ['set yelp hours on saturday to 10-2', ['listings.set_hours']],
  ['make Tom a viewer too', ['users.assign_role']],
  ['what did we earn last month vs the month before', ['reports.compare_periods']],
  ['lock Wyatt Kaur out of the automation course for now', ['enrollments.suspend', 'enrollments.revoke']],
  ['add a faq block to the fall promo page', ['landing_pages.add_section']],
  ['how much tax on order ord_0002 shipped to california?', ['tax_rules.calculate_for_order']],
  ['bump Leo Price up to the annual starter plan', ['subscriptions.change_plan']],
  ['is the onboarding booking page live?', ['booking_pages.get', 'booking_pages.list']],
  ['dupe check: merge michael and mike brown', ['contacts.merge_duplicates']],
  ['Leo Price never showed up to his demo', ['appointments.mark_no_show']],
  ['what questions does the contact us form ask', ['forms.get']],
  ["who's on the support team", ['teams.get', 'teams.list']],
  ['pin the smart lists tip post in the community', ['communities.pin_post']],
  ['reword the welcome sms template', ['templates.update_content']],
];

export async function retrievalEval({ mode = 'bm25', ks = [5, 10, 14, 20] } = {}) {
  const registry = await loadRegistry();
  const index = new ToolIndex(registry);
  const out = {};
  for (const k of ks) {
    let hit = 0;
    let total = 0;
    let scenarioFull = 0;
    let n = 0;
    const misses = [];
    let ms = 0;
    let toolCount = 0;
    for (const s of scenarios) {
      const expected = s.expect.actions ?? [];
      if (!expected.length) continue;
      n++;
      // Follow-up turns are retrieved with the previous turn as context, as the agent does.
      const found = new Set();
      let prev = '';
      for (const t of s.turns) {
        const r = await index.search([t, prev].filter(Boolean).join(' \n '), { k, mode, sticky: [...found] });
        r.ids.forEach((id) => found.add(id));
        ms += r.ms;
        toolCount += r.ids.length;
        prev = t;
      }
      let all = true;
      for (const e of expected) {
        total++;
        if ([].concat(e).some((id) => found.has(id))) hit++;
        else {
          all = false;
          misses.push({ scenario: s.id, expected: e });
        }
      }
      if (all) scenarioFull++;
    }
    out[`k${k}`] = {
      k,
      recall: Math.round((hit / total) * 1000) / 1000,
      scenarioFullRecall: Math.round((scenarioFull / n) * 1000) / 1000,
      avgToolsSent: Math.round((toolCount / n) * 10) / 10,
      avgMs: Math.round((ms / n) * 100) / 100,
      misses,
    };
  }
  const holdout = {};
  for (const k of ks) {
    const misses = [];
    let hit = 0;
    for (const [q, exp] of HOLDOUT) {
      const r = await index.search(q, { k, mode });
      if (exp.some((id) => r.ids.includes(id))) hit++;
      else misses.push({ query: q, expected: exp, top: r.top.map((t) => t.id) });
    }
    holdout[`k${k}`] = { k, recall: Math.round((hit / HOLDOUT.length) * 1000) / 1000, misses };
  }
  return { mode, scenarios: scenarios.filter((s) => s.expect.actions?.length).length, results: out, holdout };
}

if (process.argv[1]?.endsWith('retrieval.js')) {
  const res = await retrievalEval({ mode: arg('mode', 'bm25') });
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, `retrieval-${res.mode}.json`), JSON.stringify(res, null, 1));
  for (const r of Object.values(res.results))
    console.log(
      `K=${r.k}: action recall ${(r.recall * 100).toFixed(1)}%, scenarios with all tools ${(r.scenarioFullRecall * 100).toFixed(1)}%, ~${r.avgToolsSent} tools sent, ${r.avgMs}ms`,
    );
  for (const r of Object.values(res.holdout))
    console.log(`held-out paraphrases K=${r.k}: recall ${(r.recall * 100).toFixed(1)}%`);
  console.log('held-out misses at K=10:', res.holdout.k10.misses.map((m) => m.query).join(' | '));
  console.log(
    'misses at K=10:',
    res.results.k10.misses.map((m) => `${m.scenario}:${[].concat(m.expected).join('|')}`).join(', '),
  );
}
