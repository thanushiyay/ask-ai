import { z, ref, crud, fail } from '../core/kit.js';

const live = (c) => {
  if (c.status !== 'active') throw fail.state(`Calendar ${c.name} is archived`);
};
const tz = z
  .string()
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'must be an IANA timezone like America/New_York')
  .meta({ description: 'IANA timezone, e.g. America/New_York' });

export default {
  id: 'calendars',
  code: 'M20',
  title: 'Calendars',
  description: 'Configure calendars used for appointment booking.',
  keywords: ['calendar', 'booking calendar', 'meeting type', 'host', 'duration', 'buffer', 'timezone'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create calendar',
      collection: 'calendars',
      description: 'Create a booking calendar (meeting type) with duration and hosts.',
      fields: {
        name: z.string().min(1),
        description: z.string().optional(),
        durationMinutes: z.number().int().min(5).max(480).optional(),
        hostIds: z.array(ref('users')).optional(),
        timezone: tz.optional(),
      },
      validate: (a, { db }) => (a.hostIds ?? []).forEach((id) => db.must('users', id)),
      defaults: () => ({
        description: '',
        timezone: 'UTC',
        hostIds: [],
        durationMinutes: 30,
        bufferMinutes: 0,
        visibility: 'public',
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get calendar settings',
      collection: 'calendars',
      idField: 'calendarId',
      description: "Get a calendar's settings (hosts, duration, buffer, timezone, visibility).",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List calendars',
      collection: 'calendars',
      description: 'List booking calendars.',
      text: ['name', 'description'],
      filters: { visibility: z.enum(['public', 'internal', 'hidden']) },
      hide: (c) => c.status !== 'active',
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update calendar details',
      collection: 'calendars',
      idField: 'calendarId',
      description: "Update a calendar's name or description.",
      fields: { name: z.string().min(1), description: z.string() },
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'set_timezone',
      title: 'Set calendar timezone',
      collection: 'calendars',
      idField: 'calendarId',
      field: 'timezone',
      schema: tz,
      description: 'Set the timezone a calendar uses.',
      guard: live,
    }),
    crud.setField({
      code: 'A06',
      name: 'assign_host',
      title: 'Assign calendar host',
      collection: 'calendars',
      idField: 'calendarId',
      field: 'hostId',
      schema: ref('users', 'User to add as host'),
      description: 'Add a user as a host on a calendar.',
      guard: (c, a, { db }) => {
        live(c);
        const u = db.must('users', a.hostId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
        if (c.hostIds.includes(u.id)) throw fail.conflict(`${u.name} already hosts ${c.name}`);
      },
      transform: (a, c) => ({ hostIds: [...c.hostIds, a.hostId] }),
    }),
    crud.setField({
      code: 'A07',
      name: 'set_duration',
      title: 'Set appointment duration',
      collection: 'calendars',
      idField: 'calendarId',
      field: 'durationMinutes',
      schema: z.number().int().min(5).max(480),
      description: 'Set the default appointment length in minutes.',
      guard: live,
    }),
    crud.setField({
      code: 'A08',
      name: 'set_buffer',
      title: 'Set booking buffer',
      collection: 'calendars',
      idField: 'calendarId',
      field: 'bufferMinutes',
      schema: z.number().int().min(0).max(240),
      description: 'Set the buffer (minutes) between appointments.',
      guard: live,
    }),
    crud.setField({
      code: 'A09',
      name: 'set_visibility',
      title: 'Set calendar visibility',
      collection: 'calendars',
      idField: 'calendarId',
      field: 'visibility',
      schema: z.enum(['public', 'internal', 'hidden']),
      description: 'Set whether a calendar is public, internal or hidden.',
      guard: live,
    }),
    crud.transition({
      code: 'A10',
      name: 'archive',
      title: 'Archive calendar',
      collection: 'calendars',
      idField: 'calendarId',
      from: ['active'],
      to: 'archived',
      effect: 'destructive',
      description: 'Archive a calendar. Fails if it has upcoming booked appointments.',
      patch: (a, c, { db, clock }) => {
        const n = db.find(
          'appointments',
          (x) => x.calendarId === c.id && x.status === 'booked' && new Date(x.startAt) > clock.now(),
        ).length;
        if (n)
          throw fail.state(`Calendar ${c.name} has ${n} upcoming appointments; cancel or move them first`);
        return {};
      },
    }),
  ],
};
