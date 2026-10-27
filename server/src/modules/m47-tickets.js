import { z, ref, crud, action, fail, out } from '../core/kit.js';

const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const STATUS = ['open', 'pending', 'resolved', 'closed'];
const SLA = { urgent: 4, high: 8, medium: 24, low: 72 };
const notClosed = (t) => {
  if (t.status === 'closed') throw fail.state(`Ticket ${t.id} is closed`);
};
const sla = (t, clock) => {
  const due = new Date(new Date(t.createdAt).getTime() + t.slaHours * 3600_000);
  const responded = Boolean(t.firstResponseAt);
  const breached = !responded ? clock.now() > due : new Date(t.firstResponseAt) > due;
  return {
    firstResponseDueAt: due.toISOString(),
    responded,
    breached,
    hoursRemaining: responded ? null : Math.round(((due - clock.now()) / 3600_000) * 10) / 10,
  };
};

export default {
  id: 'tickets',
  code: 'M47',
  title: 'Support Tickets',
  description: 'Track customer issues and resolution work.',
  keywords: ['ticket', 'support', 'issue', 'case', 'help desk', 'complaint', 'sla', 'bug report'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create support ticket',
      effect: 'write',
      description: 'Open a support ticket for a customer issue.',
      input: z.object({
        subject: z.string().min(3),
        description: z.string().optional(),
        requesterContactId: ref('contacts').optional(),
        priority: z.enum(PRIORITY).optional(),
        ownerId: ref('users').optional(),
      }),
      handler(a, { db, actor }) {
        if (a.requesterContactId) db.must('contacts', a.requesterContactId);
        if (a.ownerId) db.must('users', a.ownerId);
        const pr = a.priority ?? 'medium';
        return db.insert(
          'tickets',
          {
            subject: a.subject,
            description: a.description ?? '',
            requesterContactId: a.requesterContactId ?? null,
            ownerId: a.ownerId ?? null,
            priority: pr,
            status: 'open',
            notes: [],
            replies: [],
            slaHours: SLA[pr],
            firstResponseAt: null,
            resolvedAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get ticket details',
      collection: 'tickets',
      idField: 'ticketId',
      description: 'Get a ticket with notes, replies and SLA.',
      enrich: (t, { clock }) => ({ sla: sla(t, clock) }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search tickets',
      collection: 'tickets',
      description:
        'Search tickets by subject text, status, priority, owner, requester, unassigned or SLA-breached.',
      text: ['subject', 'description'],
      filters: {
        status: z.union([z.enum(STATUS), z.array(z.enum(STATUS))]),
        priority: z.enum(PRIORITY),
        ownerId: ref('users'),
        requesterContactId: ref('contacts'),
      },
      extraInput: { unassigned: z.boolean().optional(), slaBreached: z.boolean().optional() },
      where: (t, a, { clock }) =>
        (!a.unassigned || !t.ownerId) && (a.slaBreached == null || sla(t, clock).breached === a.slaBreached),
    }),
    crud.setField({
      code: 'A04',
      name: 'assign_owner',
      title: 'Assign ticket owner',
      collection: 'tickets',
      idField: 'ticketId',
      field: 'ownerId',
      schema: ref('users'),
      description: 'Assign a ticket to a support user.',
      guard: (t, a, { db }) => {
        notClosed(t);
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    crud.setField({
      code: 'A05',
      name: 'set_priority',
      title: 'Set ticket priority',
      collection: 'tickets',
      idField: 'ticketId',
      field: 'priority',
      schema: z.enum(PRIORITY),
      description: 'Change ticket priority (also updates the SLA target).',
      guard: notClosed,
      transform: (a) => ({ priority: a.priority, slaHours: SLA[a.priority] }),
    }),
    action({
      code: 'A06',
      name: 'update_status',
      title: 'Update ticket status',
      effect: 'write',
      description: 'Move a ticket between open, pending, resolved and closed.',
      input: z.object({ ticketId: ref('tickets'), status: z.enum(STATUS) }),
      handler({ ticketId, status }, { db, actor, clock }) {
        const t = db.must('tickets', ticketId);
        if (t.status === status) throw fail.conflict(`Ticket is already ${status}`);
        if (t.status === 'closed') throw fail.state('Closed tickets cannot be reopened; create a new ticket');
        if (status === 'closed' && t.status !== 'resolved')
          throw fail.state('Resolve the ticket before closing it');
        return db.update(
          'tickets',
          t.id,
          {
            status,
            resolvedAt: ['resolved', 'closed'].includes(status) ? (t.resolvedAt ?? clock.nowIso()) : null,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'add_internal_note',
      title: 'Add internal ticket note',
      effect: 'write',
      description: 'Add a private note to a ticket (not visible to the requester).',
      input: z.object({ ticketId: ref('tickets'), body: z.string().min(1) }),
      handler({ ticketId, body }, { db, actor, clock }) {
        const t = db.must('tickets', ticketId);
        return db.update(
          'tickets',
          t.id,
          { notes: [...t.notes, { body, at: clock.nowIso(), by: actor }] },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'reply_to_requester',
      title: 'Reply to ticket requester',
      effect: 'external',
      description: 'Send a reply to the customer who raised the ticket (sets first response time).',
      input: z.object({
        ticketId: ref('tickets'),
        body: z.string().min(1),
        setStatus: z.enum(['pending', 'resolved']).optional(),
      }),
      handler({ ticketId, body, setStatus }, { db, actor, clock }) {
        const t = db.must('tickets', ticketId);
        notClosed(t);
        if (!t.requesterContactId) throw fail.state('Ticket has no requester contact to reply to');
        const at = clock.nowIso();
        return db.update(
          'tickets',
          t.id,
          {
            replies: [...t.replies, { body, at, by: actor }],
            firstResponseAt: t.firstResponseAt ?? at,
            ...(setStatus
              ? { status: setStatus, resolvedAt: setStatus === 'resolved' ? at : t.resolvedAt }
              : {}),
          },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A09',
      name: 'link_contact',
      title: 'Link ticket to contact',
      collection: 'tickets',
      idField: 'ticketId',
      field: 'requesterContactId',
      schema: ref('contacts'),
      description: 'Set which contact raised a ticket.',
      guard: (t, a, { db }) => {
        db.must('contacts', a.requesterContactId);
        if (t.requesterContactId === a.requesterContactId) throw fail.conflict('Already linked');
      },
    }),
    action({
      code: 'A10',
      name: 'sla_status',
      title: 'Get ticket SLA status',
      effect: 'read',
      description: 'First-response SLA target, whether it was breached, and time remaining.',
      input: z.object({ ticketId: ref('tickets') }),
      output: out.shape({ ticketId: z.string(), breached: z.boolean() }),
      handler({ ticketId }, { db, clock }) {
        const t = db.must('tickets', ticketId);
        return { ticketId: t.id, priority: t.priority, slaHours: t.slaHours, ...sla(t, clock) };
      },
    }),
  ],
};
