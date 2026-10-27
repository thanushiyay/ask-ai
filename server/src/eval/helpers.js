export function makeHelpers({ world, seed, turns }) {
  const db = world.db;
  const seedIds = (col) => new Set(seed.db.col(col).map((r) => r.id));
  const calls = turns.flatMap((t, turn) => t.trace.actionCalls.map((c) => ({ ...c, turn })));
  const replies = turns.map((t) => t.reply ?? '');
  const now = world.clock.nowIso();
  const h = {
    db,
    seed: seed.db,
    clock: world.clock,
    cal: world.clock.calendar(),
    now,
    get: (col, id) => db.get(col, id),
    find: (col, pred = () => true) => db.find(col, pred),
    seedFind: (col, pred = () => true) => seed.db.find(col, pred),
    seedGet: (col, id) => seed.db.get(col, id),
    byName: (col, name) =>
      db.findOne(col, (r) => (r.name ?? r.title ?? r.number)?.toLowerCase() === name.toLowerCase()),
    /** records that did not exist in the seed */
    created: (col, pred = () => true) => {
      const ids = seedIds(col);
      return db.find(col, (r) => !ids.has(r.id) && pred(r));
    },
    /** seed records that were modified during the scenario */
    changed: (col, pred = () => true) => {
      const ids = seedIds(col);
      return db.find(
        col,
        (r) =>
          ids.has(r.id) &&
          r.updatedAt === now &&
          JSON.stringify(r) !== JSON.stringify(seed.db.get(col, r.id)) &&
          pred(r),
      );
    },
    unchanged: (col, id) => JSON.stringify(db.get(col, id)) === JSON.stringify(seed.db.get(col, id)),
    calls,
    ok: calls.filter((c) => c.ok),
    called: (id) => calls.some((c) => c.id === id && c.ok),
    attempted: (id) => calls.some((c) => c.id === id),
    callsTo: (id) => calls.filter((c) => c.id === id),
    reply: replies.at(-1) ?? '',
    replies,
    allText: replies.join('\n'),
    outcomes: turns.map((t) => t.outcome),
    dateOf: (iso) => (iso ? String(iso).slice(0, 10) : null),
    sameSet: (a, b) => {
      const A = new Set(a);
      const B = new Set(b);
      return A.size === B.size && [...A].every((x) => B.has(x));
    },
    daysOverdue: (inv) =>
      inv.status === 'issued' && inv.balance > 0 && inv.dueDate && new Date(inv.dueDate) < world.clock.now()
        ? Math.floor((world.clock.now() - new Date(inv.dueDate)) / 864e5)
        : 0,
    mentionsNumber: (n) =>
      new RegExp(`(^|[^\\d.])${String(n).replace('.', '\\.')}([^\\d]|$)`).test(
        replies.join(' ').replace(/,(\d{3})/g, '$1'),
      ),
  };
  h.writes = (registry) => calls.filter((c) => c.ok && registry.get(c.id)?.effect !== 'read');
  return h;
}

/** Ground truth used by several scenarios (computed from the seed, never hardcoded). */
export const truth = {
  lastWeekLeadsToFollowUp(h) {
    const lw = h.seedFind(
      'leads',
      (l) => l.createdAt >= h.cal.lastWeek.from && l.createdAt < h.cal.lastWeek.to,
    );
    const replied = new Set(h.seedFind('conversations', (c) => c.hasInbound).map((c) => c.contactId));
    const booked = new Set(h.seedFind('appointments', (a) => a.status === 'booked').map((a) => a.contactId));
    return lw.filter((l) => !replied.has(l.contactId) && !booked.has(l.contactId));
  },
  overdueToRemind(h, minDays = 16) {
    const reminded = new Set(
      h
        .seedFind('emails', (e) => e.category === 'invoice_reminder' && e.sentAt >= h.cal.thisWeek.from)
        .map((e) => e.contactId),
    );
    return h.seedFind('invoices', (i) => h.daysOverdue(i) >= minDays && !reminded.has(i.contactId));
  },
  unavailableUserIds(h) {
    return h
      .seedFind(
        'users',
        (u) =>
          u.status !== 'active' ||
          h.seedGet('availability', `avl_${u.id}`)?.blocks.some((b) => b.start <= h.now && h.now < b.end),
      )
      .map((u) => u.id);
  },
};
