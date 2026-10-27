import { z, s, ref, action, fail, out } from '../core/kit.js';
import { availabilityFor, conflictsFor, findSlots } from './_scheduling.js';

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .meta({ description: 'Time HH:MM (24h, UTC)' });
const range = z.object({ start: hhmm, end: hhmm }).refine((r) => r.start < r.end, 'start must be before end');
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const user = ref('users', 'User whose availability to manage');

function avOf(db, userId) {
  db.must('users', userId);
  const av = availabilityFor(db, userId);
  if (!av) throw fail.notFound('availability', userId);
  return av;
}

export default {
  id: 'availability',
  code: 'M22',
  title: 'Availability',
  description: 'Manage bookable time and scheduling constraints.',
  keywords: [
    'availability',
    'available',
    'unavailable',
    'block calendar',
    'block off',
    'blocked time',
    'time off',
    'free time',
    'working hours',
    'slots',
    'open slots',
    'out of office',
    'vacation',
    'busy',
    'conflict',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'set_weekly_hours',
      title: 'Set weekly working hours',
      effect: 'write',
      description: "Set a user's recurring weekly working hours per weekday (empty list = day off).",
      input: z.object({
        userId: user,
        weeklyHours: z
          .partialRecord(z.enum(DAYS), z.array(range))
          .meta({ description: 'e.g. {"mon":[{"start":"09:00","end":"17:00"}]}' }),
      }),
      handler({ userId, weeklyHours }, { db, actor }) {
        const av = avOf(db, userId);
        return db.update(
          'availability',
          av.id,
          { weeklyHours: { ...av.weeklyHours, ...weeklyHours } },
          actor,
        );
      },
    }),
    action({
      code: 'A02',
      name: 'get_weekly_hours',
      title: 'Get weekly working hours',
      effect: 'read',
      description: "Get a user's weekly hours, overrides, blocks and booking constraints.",
      input: z.object({ userId: user }),
      handler: ({ userId }, { db }) => avOf(db, userId),
    }),
    action({
      code: 'A03',
      name: 'add_date_override',
      title: 'Add date-specific availability',
      effect: 'write',
      description: 'Override availability on one date (e.g. extra hours on a Saturday, or shorter day).',
      input: z.object({ userId: user, date: s.date('Date YYYY-MM-DD'), ranges: z.array(range) }),
      handler({ userId, date, ranges }, { db, actor }) {
        const av = avOf(db, userId);
        const d = date.slice(0, 10);
        return db.update(
          'availability',
          av.id,
          { dateOverrides: [...av.dateOverrides.filter((o) => o.date !== d), { date: d, ranges }] },
          actor,
        );
      },
    }),
    action({
      code: 'A04',
      name: 'remove_date_override',
      title: 'Remove date-specific availability',
      effect: 'write',
      description: 'Remove a date override so the weekly hours apply again.',
      input: z.object({ userId: user, date: s.date('Date YYYY-MM-DD') }),
      handler({ userId, date }, { db, actor }) {
        const av = avOf(db, userId);
        const d = date.slice(0, 10);
        if (!av.dateOverrides.some((o) => o.date === d)) throw fail.notFound('date override', d);
        return db.update(
          'availability',
          av.id,
          { dateOverrides: av.dateOverrides.filter((o) => o.date !== d) },
          actor,
        );
      },
    }),
    action({
      code: 'A05',
      name: 'block_time',
      title: 'Block time range',
      effect: 'write',
      description: 'Block a time range (vacation, out of office, focus time) so it cannot be booked.',
      input: z.object({
        userId: user,
        start: s.datetime('Block start'),
        end: s.datetime('Block end'),
        reason: z.string().optional(),
      }),
      handler({ userId, start, end, reason }, { db, actor }) {
        if (new Date(end) <= new Date(start)) throw fail.validation('end must be after start');
        const av = avOf(db, userId);
        const block = {
          id: `blk_${db.nextId('_child').split('_').pop()}`,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          reason: reason ?? 'Busy',
        };
        const clashes = db.find(
          'appointments',
          (a) =>
            a.hostId === userId &&
            a.status === 'booked' &&
            new Date(a.startAt) < new Date(block.end) &&
            new Date(block.start) < new Date(a.endAt),
        );
        return {
          ...db.update('availability', av.id, { blocks: [...av.blocks, block] }, actor),
          block,
          affectedAppointments: clashes.map((a) => a.id),
        };
      },
    }),
    action({
      code: 'A06',
      name: 'remove_block',
      title: 'Remove time block',
      effect: 'write',
      description: 'Remove a previously blocked time range.',
      input: z.object({ userId: user, blockId: z.string().min(1) }),
      handler({ userId, blockId }, { db, actor }) {
        const av = avOf(db, userId);
        if (!av.blocks.some((b) => b.id === blockId)) throw fail.notFound('time block', blockId);
        return db.update('availability', av.id, { blocks: av.blocks.filter((b) => b.id !== blockId) }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'set_min_notice',
      title: 'Set minimum booking notice',
      effect: 'write',
      description: 'Set how many hours in advance bookings must be made.',
      input: z.object({ userId: user, hours: z.number().min(0).max(720) }),
      handler({ userId, hours }, { db, actor }) {
        const av = avOf(db, userId);
        return db.update('availability', av.id, { minNoticeHours: hours }, actor);
      },
    }),
    action({
      code: 'A08',
      name: 'set_max_horizon',
      title: 'Set maximum booking horizon',
      effect: 'write',
      description: 'Set how many days ahead a user can be booked.',
      input: z.object({ userId: user, days: z.number().int().min(1).max(365) }),
      handler({ userId, days }, { db, actor }) {
        const av = avOf(db, userId);
        return db.update('availability', av.id, { maxHorizonDays: days }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'find_slots',
      title: 'Find available slots',
      effect: 'read',
      description:
        'Find free bookable time slots for a user between two dates (respects hours, blocks, appointments, notice and horizon).',
      input: z.object({
        userId: user,
        from: s.datetime('Search start'),
        to: s.datetime('Search end'),
        durationMinutes: z.number().int().min(5).max(480).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      output: out.shape({
        userId: z.string(),
        slots: z.array(z.object({ start: z.string(), end: z.string() })),
      }),
      handler({ userId, ...o }, { db, clock }) {
        avOf(db, userId);
        if (new Date(o.to) - new Date(o.from) > 31 * 86_400_000)
          throw fail.validation('Search range is limited to 31 days');
        return { userId, slots: findSlots(db, clock, userId, o) };
      },
    }),
    action({
      code: 'A10',
      name: 'check_conflicts',
      title: 'Check scheduling conflicts',
      effect: 'read',
      description: 'Check whether a user is free for a proposed time range and list any conflicts.',
      input: z.object({ userId: user, start: s.datetime('Proposed start'), end: s.datetime('Proposed end') }),
      output: out.shape({ userId: z.string(), free: z.boolean(), conflicts: z.array(z.string()) }),
      handler({ userId, start, end }, { db, clock }) {
        avOf(db, userId);
        const c = conflictsFor(db, clock, userId, start, end);
        return { userId, free: !c.length, conflicts: c };
      },
    }),
  ],
};
