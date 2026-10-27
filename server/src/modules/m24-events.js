import { z, s, ref, crud, action, fail } from '../core/kit.js';

const count = (e, st) => e.registrations.filter((r) => r.status === st).length;
const seats = (e) => count(e, 'registered') + count(e, 'checked_in');
const reg = (e, contactId) =>
  e.registrations.find((r) => r.contactId === contactId && r.status !== 'cancelled');

export default {
  id: 'events',
  code: 'M24',
  title: 'Events',
  description: 'Manage group sessions and registrations.',
  keywords: [
    'event',
    'webinar',
    'workshop',
    'session',
    'registration',
    'rsvp',
    'waitlist',
    'check in',
    'attendee',
    'masterclass',
    'meetup',
  ],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create event',
      collection: 'events',
      description: 'Create a group event (webinar, workshop, meetup) with capacity.',
      fields: {
        name: z.string().min(1),
        startAt: s.datetime('Start'),
        endAt: s.datetime('End').optional(),
        location: z.string().optional(),
        capacity: z.number().int().min(1).optional(),
        description: z.string().optional(),
      },
      validate: (a, { clock }) => {
        if (new Date(a.startAt) < clock.now()) throw fail.validation('Event start must be in the future');
        if (a.endAt && a.endAt <= a.startAt) throw fail.validation('endAt must be after startAt');
      },
      defaults: (a) => ({
        description: '',
        location: 'Online',
        capacity: 100,
        registrations: [],
        status: 'scheduled',
        endAt: new Date(new Date(a.startAt).getTime() + 3600_000).toISOString(),
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get event details',
      collection: 'events',
      idField: 'eventId',
      description: 'Get an event with registration counts.',
      enrich: (e) => ({
        registered: seats(e),
        waitlisted: count(e, 'waitlisted'),
        checkedIn: count(e, 'checked_in'),
        seatsLeft: Math.max(e.capacity - seats(e), 0),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search events',
      collection: 'events',
      description: 'Search events by name/location or start date range.',
      text: ['name', 'location', 'description'],
      filters: { status: z.enum(['scheduled', 'live', 'completed', 'cancelled']) },
      dates: { start: 'startAt' },
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update event details',
      collection: 'events',
      idField: 'eventId',
      description: "Update an event's name, description, location or times.",
      fields: {
        name: z.string().min(1),
        description: z.string(),
        location: z.string(),
        startAt: s.datetime('Start'),
        endAt: s.datetime('End'),
      },
    }),
    crud.setField({
      code: 'A05',
      name: 'set_capacity',
      title: 'Set event capacity',
      collection: 'events',
      idField: 'eventId',
      field: 'capacity',
      schema: z.number().int().min(1),
      description: 'Set max registrations. Cannot go below current registrations.',
      guard: (e, a) => {
        if (a.capacity < seats(e))
          throw fail.state(`${seats(e)} people are already registered; capacity cannot be ${a.capacity}`);
      },
    }),
    action({
      code: 'A06',
      name: 'register',
      title: 'Register attendee',
      effect: 'write',
      description: 'Register a contact for an event. Fails when full (use waitlist instead).',
      input: z.object({ eventId: ref('events'), contactId: ref('contacts') }),
      handler({ eventId, contactId }, { db, actor, clock }) {
        const e = db.must('events', eventId);
        db.must('contacts', contactId);
        if (['completed', 'cancelled'].includes(e.status)) throw fail.state(`Event is ${e.status}`);
        if (reg(e, contactId)) throw fail.conflict(`Contact is already ${reg(e, contactId).status}`);
        if (seats(e) >= e.capacity)
          throw fail.state(
            `${e.name} is full (${e.capacity}/${e.capacity}); add them to the waitlist instead`,
          );
        return db.update(
          'events',
          e.id,
          {
            registrations: [
              ...e.registrations,
              {
                id: `reg_${db.nextId('_child').split('_').pop()}`,
                contactId,
                status: 'registered',
                at: clock.nowIso(),
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'cancel_registration',
      title: 'Cancel attendee registration',
      effect: 'write',
      description: "Cancel a contact's registration for an event.",
      input: z.object({ eventId: ref('events'), contactId: ref('contacts') }),
      handler({ eventId, contactId }, { db, actor }) {
        const e = db.must('events', eventId);
        const r = reg(e, contactId);
        if (!r) throw fail.state('Contact is not registered for this event');
        r.status = 'cancelled';
        return db.update('events', e.id, { registrations: e.registrations }, actor);
      },
    }),
    action({
      code: 'A08',
      name: 'add_to_waitlist',
      title: 'Add attendee to waitlist',
      effect: 'write',
      description: "Put a contact on an event's waitlist.",
      input: z.object({ eventId: ref('events'), contactId: ref('contacts') }),
      handler({ eventId, contactId }, { db, actor, clock }) {
        const e = db.must('events', eventId);
        db.must('contacts', contactId);
        if (reg(e, contactId)) throw fail.conflict(`Contact is already ${reg(e, contactId).status}`);
        return db.update(
          'events',
          e.id,
          {
            registrations: [
              ...e.registrations,
              {
                id: `reg_${db.nextId('_child').split('_').pop()}`,
                contactId,
                status: 'waitlisted',
                at: clock.nowIso(),
              },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'promote_waitlisted',
      title: 'Promote waitlisted attendee',
      effect: 'write',
      description:
        'Move a waitlisted contact (default: first in line) into a registered seat if one is free.',
      input: z.object({ eventId: ref('events'), contactId: ref('contacts').optional() }),
      handler({ eventId, contactId }, { db, actor }) {
        const e = db.must('events', eventId);
        const r = contactId
          ? e.registrations.find((x) => x.contactId === contactId && x.status === 'waitlisted')
          : e.registrations.find((x) => x.status === 'waitlisted');
        if (!r) throw fail.state('No matching waitlisted attendee');
        if (seats(e) >= e.capacity)
          throw fail.state(`${e.name} is still full; raise capacity or cancel a registration first`);
        r.status = 'registered';
        return db.update('events', e.id, { registrations: e.registrations }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'check_in',
      title: 'Check in attendee',
      effect: 'write',
      description: 'Check in a registered attendee at the event.',
      input: z.object({ eventId: ref('events'), contactId: ref('contacts') }),
      handler({ eventId, contactId }, { db, actor, clock }) {
        const e = db.must('events', eventId);
        const r = reg(e, contactId);
        if (!r || r.status !== 'registered')
          throw fail.state(r ? `Attendee is ${r.status}` : 'Contact is not registered');
        if (new Date(e.startAt) - clock.now() > 2 * 3600_000)
          throw fail.state('Check-in opens 2 hours before the event');
        Object.assign(r, { status: 'checked_in', checkedInAt: clock.nowIso() });
        return db.update('events', e.id, { registrations: e.registrations }, actor);
      },
    }),
  ],
};
