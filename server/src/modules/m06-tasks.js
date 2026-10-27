import { z, s, ref, crud, action, fail } from '../core/kit.js';

const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const TYPES = ['general', 'follow_up', 'call', 'email', 'meeting', 'todo'];
const openGuard = (t) => {
  if (t.status !== 'open') throw fail.state(`Task ${t.id} is ${t.status}`);
};

export default {
  id: 'tasks',
  code: 'M06',
  title: 'Tasks',
  description: 'Organize work, deadlines, and assignments.',
  keywords: [
    'task',
    'todo',
    'to-do',
    'follow up',
    'follow-up',
    'reminder',
    'deadline',
    'due',
    'assignment',
    'call back',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create task',
      effect: 'write',
      description:
        'Create a task (e.g. a follow-up) optionally linked to a contact/lead/opportunity, with owner, due date and priority.',
      input: z.object({
        title: s.text('Short task title, e.g. "Follow up with Jane Doe"'),
        description: z.string().optional(),
        contactId: ref('contacts').optional(),
        leadId: ref('leads').optional(),
        opportunityId: ref('opportunities').optional(),
        ownerId: ref('users', 'User responsible for the task').optional(),
        dueDate: s.datetime('When the task is due (ISO date or date-time)').optional(),
        priority: z.enum(PRIORITY).optional(),
        type: z.enum(TYPES).optional(),
      }),
      handler(a, { db, actor }) {
        let contactId = a.contactId ?? null;
        if (a.leadId) contactId ??= db.must('leads', a.leadId).contactId;
        if (a.opportunityId) contactId ??= db.must('opportunities', a.opportunityId).contactId;
        if (contactId) db.must('contacts', contactId);
        if (a.ownerId) {
          const u = db.must('users', a.ownerId);
          if (u.status !== 'active')
            throw fail.state(`User ${u.name} is ${u.status} and cannot be assigned tasks`);
        }
        const relatedTo = a.leadId
          ? { type: 'lead', id: a.leadId }
          : a.opportunityId
            ? { type: 'opportunity', id: a.opportunityId }
            : null;
        return db.insert(
          'tasks',
          {
            title: a.title,
            description: a.description ?? '',
            contactId,
            relatedTo,
            ownerId: a.ownerId ?? null,
            dueDate: a.dueDate ?? null,
            priority: a.priority ?? 'medium',
            status: 'open',
            type: a.type ?? (/follow/i.test(a.title) ? 'follow_up' : 'general'),
            completedAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get task details',
      collection: 'tasks',
      idField: 'taskId',
      description: 'Get one task by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search tasks',
      collection: 'tasks',
      description:
        'Search tasks by title text, status, owner, contact(s), lead(s), priority, type, due date range or overdue flag. Use leadIds or contactIds to find the tasks for many records at once.',
      text: ['title', 'description'],
      filters: {
        status: z.union([
          z.enum(['open', 'completed', 'cancelled']),
          z.array(z.enum(['open', 'completed', 'cancelled'])),
        ]),
        ownerId: ref('users'),
        contactId: ref('contacts'),
        priority: z.enum(PRIORITY),
        type: z.enum(TYPES),
      },
      dates: { created: 'createdAt', due: 'dueDate' },
      extraInput: {
        overdue: z.boolean().optional().meta({ description: 'Only open tasks past their due date' }),
        leadId: ref('leads').optional(),
        leadIds: z.array(z.string()).optional().meta({ description: 'Tasks linked to any of these leads' }),
        contactIds: z
          .array(z.string())
          .optional()
          .meta({ description: 'Tasks linked to any of these contacts' }),
      },
      where: (t, a, { clock }) =>
        (!a.overdue || (t.status === 'open' && t.dueDate && new Date(t.dueDate) < clock.now())) &&
        (!a.leadId || t.relatedTo?.id === a.leadId) &&
        (!a.leadIds || (t.relatedTo?.type === 'lead' && a.leadIds.includes(t.relatedTo.id))) &&
        (!a.contactIds || a.contactIds.includes(t.contactId)),
    }),
    crud.update({
      code: 'A04',
      name: 'update_description',
      title: 'Update task description',
      collection: 'tasks',
      idField: 'taskId',
      description: "Update a task's title and/or description.",
      fields: { title: z.string().min(1), description: z.string() },
      guard: openGuard,
    }),
    crud.setField({
      code: 'A05',
      name: 'assign_owner',
      title: 'Assign task owner',
      collection: 'tasks',
      idField: 'taskId',
      field: 'ownerId',
      schema: ref('users'),
      description: 'Assign a task to a user.',
      guard: (t, a, { db }) => {
        openGuard(t);
        const u = db.must('users', a.ownerId);
        if (u.status !== 'active') throw fail.state(`User ${u.name} is ${u.status}`);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_due_date',
      title: 'Set task due date',
      collection: 'tasks',
      idField: 'taskId',
      field: 'dueDate',
      schema: s.datetime('New due date (ISO)'),
      description: 'Change when a task is due.',
      guard: openGuard,
    }),
    crud.setField({
      code: 'A07',
      name: 'set_priority',
      title: 'Set task priority',
      collection: 'tasks',
      idField: 'taskId',
      field: 'priority',
      schema: z.enum(PRIORITY),
      description: 'Set task priority (low, medium, high, urgent).',
      guard: openGuard,
    }),
    crud.transition({
      code: 'A08',
      name: 'complete',
      title: 'Mark task complete',
      collection: 'tasks',
      idField: 'taskId',
      from: ['open'],
      to: 'completed',
      description: 'Mark an open task as completed.',
      patch: (a, r, { clock }) => ({ completedAt: clock.nowIso() }),
    }),
    crud.transition({
      code: 'A09',
      name: 'reopen',
      title: 'Reopen task',
      collection: 'tasks',
      idField: 'taskId',
      from: ['completed', 'cancelled'],
      to: 'open',
      description: 'Reopen a completed or cancelled task.',
      patch: () => ({ completedAt: null }),
    }),
    crud.transition({
      code: 'A10',
      name: 'cancel',
      title: 'Cancel task',
      collection: 'tasks',
      idField: 'taskId',
      from: ['open'],
      to: 'cancelled',
      effect: 'destructive',
      description: 'Cancel an open task (it will not be done).',
      extraInput: { reason: z.string().optional() },
      patch: (a) => ({ cancelReason: a.reason ?? null }),
    }),
  ],
};
