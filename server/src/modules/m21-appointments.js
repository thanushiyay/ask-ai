import { z, s, ref, crud, action, fail } from '../core/kit.js';
import { conflictsFor } from './_scheduling.js';

const booked = (a) => {
  if (a.status !== 'booked') throw fail.state(`Appointment ${a.id} is ${a.status}`);
};

export default {
  id: 'appointments',
  code: 'M21',
  title: 'Appointments',
  description: 'Manage booked meetings and their outcomes.',
  keywords: [
    'appointment',
    'meeting',
    'booking',
    'booked',
    'call',
    'demo',
    'schedule a meeting',
    'reschedule',
    'no-show',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create appointment',
      effect: 'write',
      description:
        "Book an appointment for a contact on a calendar at a start time. Checks the host's availability and conflicts.",
      input: z.object({
        calendarId: ref('calendars'),
        contactId: ref('contacts'),
        startAt: s.datetime('Start date-time (ISO, UTC)'),
        hostId: ref('users').optional().meta({ description: 'Defaults to the first available host' }),
        title: z.string().optional(),
      }),
      handler(a, { db, actor, clock }) {
        const cal = db.must('calendars', a.calendarId);
        if (cal.status !== 'active') throw fail.state(`Calendar ${cal.name} is archived`);
        const c = db.must('contacts', a.contactId);
        const start = new Date(a.startAt);
        const end = new Date(start.getTime() + cal.durationMinutes * 60000);
        const hosts = a.hostId ? [a.hostId] : cal.hostIds;
        if (a.hostId && !cal.hostIds.includes(a.hostId))
          throw fail.validation(`User ${a.hostId} is not a host of ${cal.name}`);
        let chosen = null;
        const why = {};
        for (const h of hosts) {
          const u = db.get('users', h);
          if (u?.status !== 'active') {
            why[h] = ['inactive'];
            continue;
          }
          const p = conflictsFor(db, clock, h, start, end);
          if (!p.length) {
            chosen = h;
            break;
          }
          why[h] = p;
        }
        if (!chosen) throw fail.conflict(`No host is free at ${a.startAt}`, { reasons: why });
        return db.insert(
          'appointments',
          {
            calendarId: cal.id,
            contactId: c.id,
            hostId: chosen,
            title: a.title ?? `${cal.name} with ${c.name}`,
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            status: 'booked',
            attendees: [{ contactId: c.id, status: 'confirmed' }],
            notes: '',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get appointment details',
      collection: 'appointments',
      idField: 'appointmentId',
      description: 'Get one appointment by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search appointments',
      collection: 'appointments',
      description:
        'Search appointments by contact(s), host, calendar, status (booked/cancelled/completed/no_show) or start time range. Use contactIds + status=booked to find which contacts have a booked appointment.',
      text: ['title'],
      filters: {
        contactId: ref('contacts'),
        hostId: ref('users'),
        calendarId: ref('calendars'),
        status: z.union([
          z.enum(['booked', 'cancelled', 'completed', 'no_show']),
          z.array(z.enum(['booked', 'cancelled', 'completed', 'no_show'])),
        ]),
      },
      dates: { start: 'startAt', created: 'createdAt' },
      extraInput: {
        contactIds: z
          .array(z.string())
          .optional()
          .meta({ description: 'Appointments for any of these contacts' }),
        upcoming: z.boolean().optional().meta({ description: 'Only appointments starting after now' }),
      },
      where: (x, a, { clock }) =>
        (!a.contactIds || a.contactIds.includes(x.contactId)) &&
        (!a.upcoming || new Date(x.startAt) > clock.now()),
      sort: (a, b) => a.startAt.localeCompare(b.startAt),
    }),
    action({
      code: 'A04',
      name: 'reschedule',
      title: 'Reschedule appointment',
      effect: 'external',
      description:
        'Move a booked appointment to a new start time (same host, conflict-checked). The attendee is notified.',
      input: z.object({ appointmentId: ref('appointments'), startAt: s.datetime('New start date-time') }),
      handler({ appointmentId, startAt }, { db, actor, clock }) {
        const ap = db.must('appointments', appointmentId);
        booked(ap);
        const dur = new Date(ap.endAt) - new Date(ap.startAt);
        const start = new Date(startAt);
        const end = new Date(start.getTime() + dur);
        const p = conflictsFor(db, clock, ap.hostId, start, end, { ignoreAppointmentId: ap.id });
        if (p.length)
          throw fail.conflict(`Cannot reschedule to ${startAt}: ${p.join(', ')}`, { problems: p });
        return db.update(
          'appointments',
          ap.id,
          { startAt: start.toISOString(), endAt: end.toISOString(), rescheduledFrom: ap.startAt },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'cancel',
      title: 'Cancel appointment',
      collection: 'appointments',
      idField: 'appointmentId',
      from: ['booked'],
      to: 'cancelled',
      effect: 'external',
      extraInput: { reason: z.string().optional() },
      description: 'Cancel a booked appointment (attendees are notified).',
      patch: (a) => ({ cancelReason: a.reason ?? null }),
    }),
    crud.setField({
      code: 'A06',
      name: 'assign_host',
      title: 'Assign appointment host',
      collection: 'appointments',
      idField: 'appointmentId',
      field: 'hostId',
      schema: ref('users'),
      description: 'Change the host of a booked appointment (must be free at that time).',
      guard: (ap, a, { db, clock }) => {
        booked(ap);
        const u = db.must('users', a.hostId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
        const p = conflictsFor(db, clock, a.hostId, ap.startAt, ap.endAt).filter(
          (x) => !x.includes('notice'),
        );
        if (p.length) throw fail.conflict(`${u.name} is not free: ${p.join(', ')}`);
      },
    }),
    action({
      code: 'A07',
      name: 'add_attendee',
      title: 'Add appointment attendee',
      effect: 'write',
      description: 'Add another contact as an attendee of an appointment.',
      input: z.object({ appointmentId: ref('appointments'), contactId: ref('contacts') }),
      handler({ appointmentId, contactId }, { db, actor }) {
        const ap = db.must('appointments', appointmentId);
        booked(ap);
        db.must('contacts', contactId);
        if (ap.attendees.some((x) => x.contactId === contactId)) throw fail.conflict('Already an attendee');
        return db.update(
          'appointments',
          ap.id,
          { attendees: [...ap.attendees, { contactId, status: 'invited' }] },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'remove_attendee',
      title: 'Remove appointment attendee',
      effect: 'write',
      description: 'Remove an attendee (not the primary contact) from an appointment.',
      input: z.object({ appointmentId: ref('appointments'), contactId: ref('contacts') }),
      handler({ appointmentId, contactId }, { db, actor }) {
        const ap = db.must('appointments', appointmentId);
        if (contactId === ap.contactId)
          throw fail.validation('Cannot remove the primary contact; cancel the appointment instead');
        if (!ap.attendees.some((x) => x.contactId === contactId))
          throw fail.state('That contact is not an attendee');
        return db.update(
          'appointments',
          ap.id,
          { attendees: ap.attendees.filter((x) => x.contactId !== contactId) },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'mark_no_show',
      title: 'Mark attendee no-show',
      effect: 'write',
      description: 'Mark an attendee (default: primary contact) as a no-show for a past appointment.',
      input: z.object({ appointmentId: ref('appointments'), contactId: ref('contacts').optional() }),
      handler({ appointmentId, contactId }, { db, actor, clock }) {
        const ap = db.must('appointments', appointmentId);
        if (!['booked', 'completed'].includes(ap.status))
          throw fail.state(`Appointment ${ap.id} is ${ap.status}`);
        if (new Date(ap.startAt) > clock.now())
          throw fail.state('Cannot mark a no-show before the appointment has started');
        const who = contactId ?? ap.contactId;
        const att = ap.attendees.find((x) => x.contactId === who);
        if (!att) throw fail.state('That contact is not an attendee');
        att.status = 'no_show';
        return db.update(
          'appointments',
          ap.id,
          { attendees: ap.attendees, status: who === ap.contactId ? 'no_show' : ap.status },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'mark_completed',
      title: 'Mark appointment completed',
      effect: 'write',
      description: 'Mark a past appointment as completed, with optional outcome notes.',
      input: z.object({ appointmentId: ref('appointments'), notes: z.string().optional() }),
      handler({ appointmentId, notes }, { db, actor, clock }) {
        const ap = db.must('appointments', appointmentId);
        booked(ap);
        if (new Date(ap.startAt) > clock.now())
          throw fail.state(`Appointment ${ap.id} has not happened yet (starts ${ap.startAt})`);
        return db.update('appointments', ap.id, { status: 'completed', notes: notes ?? ap.notes }, actor);
      },
    }),
  ],
};
