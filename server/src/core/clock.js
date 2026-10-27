const DAY = 86_400_000;

/** The date tests and the benchmark run at, so every run sees the same data. */
export const REFERENCE_NOW = '2026-10-15T10:00:00.000Z';

/** The app's "now": FIXED_NOW when set, otherwise the real time (to the minute). */
export function appNow() {
  if (process.env.FIXED_NOW) return process.env.FIXED_NOW;
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return now.toISOString();
}

export function createClock(isoNow = REFERENCE_NOW) {
  const now = new Date(isoNow);
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid date for the clock: ${isoNow}`);

  const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  // ISO week: Monday is day 0
  const startOfWeek = (d) => addDays(startOfDay(d), -((d.getUTCDay() + 6) % 7));
  const iso = (d) => d.toISOString();
  const date = (d) => d.toISOString().slice(0, 10);

  return {
    now: () => new Date(now),
    nowIso: () => iso(now),
    today: () => date(now),
    addDays,
    startOfDay,
    startOfWeek,
    iso,
    date,
    daysAgo: (n) => addDays(now, -n),
    daysFromNow: (n) => addDays(now, n),
    daysBetween: (a, b) => Math.floor((new Date(b) - new Date(a)) / DAY),
    /** Human/LLM-facing calendar cheat sheet so relative dates are resolved consistently. */
    calendar() {
      const sod = startOfDay(now);
      const sow = startOfWeek(now);
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      return {
        now: iso(now),
        weekday,
        today: date(sod),
        tomorrow: date(addDays(sod, 1)),
        yesterday: date(addDays(sod, -1)),
        thisWeek: { from: iso(sow), to: iso(addDays(sow, 7)) },
        lastWeek: { from: iso(addDays(sow, -7)), to: iso(sow) },
        nextWeek: { from: iso(addDays(sow, 7)), to: iso(addDays(sow, 14)) },
        last7Days: { from: iso(addDays(now, -7)), to: iso(now) },
        last30Days: { from: iso(addDays(now, -30)), to: iso(now) },
        thisMonth: {
          from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
          to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))),
        },
      };
    },
  };
}
