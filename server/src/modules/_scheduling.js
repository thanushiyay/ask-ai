const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MIN = 60_000;
const atTime = (date, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date);
  d.setUTCHours(h, m, 0, 0);
  return d;
};
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

export function availabilityFor(db, userId) {
  return db.get('availability', `avl_${userId}`) ?? db.findOne('availability', (a) => a.userId === userId);
}

/** Working windows for a single UTC day, honouring date-specific overrides. */
function windowsForDay(av, day) {
  const iso = day.toISOString().slice(0, 10);
  const override = av.dateOverrides.find((o) => o.date === iso);
  const ranges = override ? override.ranges : (av.weeklyHours[DAYS[day.getUTCDay()]] ?? []);
  return ranges.map((r) => [atTime(day, r.start), atTime(day, r.end)]);
}

function busyRanges(db, userId, av) {
  const appts = db
    .find('appointments', (a) => a.hostId === userId && a.status === 'booked')
    .map((a) => [new Date(a.startAt), new Date(a.endAt), `appointment ${a.id}`]);
  const blocks = av.blocks.map((b) => [new Date(b.start), new Date(b.end), `blocked: ${b.reason ?? 'busy'}`]);
  return [...appts, ...blocks];
}

export function conflictsFor(db, clock, userId, start, end, { ignoreAppointmentId } = {}) {
  const av = availabilityFor(db, userId);
  const problems = [];
  if (!av) return ['user has no availability configured'];
  const s = new Date(start);
  const e = new Date(end);
  if (!windowsForDay(av, s).some(([w0, w1]) => s >= w0 && e <= w1)) problems.push('outside working hours');
  for (const [b0, b1, why] of busyRanges(db, userId, av)) {
    if (ignoreAppointmentId && why === `appointment ${ignoreAppointmentId}`) continue;
    if (overlaps(s, e, b0, b1)) problems.push(`overlaps ${why}`);
  }
  if (s - clock.now() < av.minNoticeHours * 3600_000) problems.push(`less than ${av.minNoticeHours}h notice`);
  if (s - clock.now() > av.maxHorizonDays * 86_400_000)
    problems.push(`beyond ${av.maxHorizonDays}-day booking horizon`);
  return problems;
}

export function findSlots(db, clock, userId, { from, to, durationMinutes = 30, limit = 20 }) {
  const av = availabilityFor(db, userId);
  if (!av) return [];
  const busy = busyRanges(db, userId, av);
  const earliest = new Date(Math.max(new Date(from), clock.now().getTime() + av.minNoticeHours * 3600_000));
  const horizon = new Date(clock.now().getTime() + av.maxHorizonDays * 86_400_000);
  const end = new Date(Math.min(new Date(to), horizon));
  const slots = [];
  for (
    let day = clock.startOfDay(new Date(from));
    day < end && slots.length < limit;
    day = clock.addDays(day, 1)
  ) {
    for (const [w0, w1] of windowsForDay(av, day)) {
      for (
        let t = new Date(w0);
        t.getTime() + durationMinutes * MIN <= w1.getTime();
        t = new Date(t.getTime() + 30 * MIN)
      ) {
        const te = new Date(t.getTime() + durationMinutes * MIN);
        if (t < earliest || te > end) continue;
        if (busy.some(([b0, b1]) => overlaps(t, te, b0, b1))) continue;
        slots.push({ start: t.toISOString(), end: te.toISOString() });
        if (slots.length >= limit) break;
      }
    }
  }
  return slots;
}

/** "Available right now" = active user with no block covering now. */
export function isAvailableNow(db, clock, user) {
  if (user.status !== 'active') return false;
  const av = availabilityFor(db, user.id);
  if (!av) return true;
  const now = clock.now();
  return !av.blocks.some((b) => new Date(b.start) <= now && now < new Date(b.end));
}
