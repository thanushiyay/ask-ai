import { z, ref, crud, action, fail, out, ruleSchema, matchRule } from '../core/kit.js';

const EVENT_TYPES = [
  'lead.created',
  'contact.created',
  'form.submitted',
  'appointment.booked',
  'appointment.no_show',
  'invoice.overdue',
  'payment.failed',
  'tag.added',
  'opportunity.stage_changed',
  'ticket.created',
  'review.received',
];

export default {
  id: 'triggers',
  code: 'M17',
  title: 'Event Triggers',
  description: 'Connect incoming events to workflow execution.',
  keywords: ['trigger', 'event', 'when', 'whenever', 'on new lead', 'webhook', 'automation trigger', 'fire'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create event trigger',
      effect: 'write',
      description: 'Create a (disabled) trigger for an event type, optionally bound to a workflow.',
      input: z.object({
        name: z.string().min(1),
        eventType: z.enum(EVENT_TYPES),
        workflowId: ref('workflows').optional(),
        conditions: z.array(ruleSchema).optional(),
      }),
      handler(a, { db, actor }) {
        if (a.workflowId) db.must('workflows', a.workflowId);
        return db.insert(
          'triggers',
          {
            name: a.name,
            eventType: a.eventType,
            conditions: a.conditions ?? [],
            workflowId: a.workflowId ?? null,
            enabled: false,
            firings: [],
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get trigger configuration',
      collection: 'triggers',
      idField: 'triggerId',
      description: "Get a trigger's event type, conditions, bound workflow and state.",
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List event triggers',
      collection: 'triggers',
      description: 'List triggers by name, event type, workflow or enabled state.',
      text: ['name'],
      filters: { eventType: z.enum(EVENT_TYPES), workflowId: ref('workflows'), enabled: z.boolean() },
    }),
    crud.setField({
      code: 'A04',
      name: 'set_event_type',
      title: 'Set trigger event type',
      collection: 'triggers',
      idField: 'triggerId',
      field: 'eventType',
      schema: z.enum(EVENT_TYPES),
      description: 'Change which event a trigger listens for.',
    }),
    crud.setField({
      code: 'A05',
      name: 'update_conditions',
      title: 'Update trigger conditions',
      collection: 'triggers',
      idField: 'triggerId',
      field: 'conditions',
      schema: z.array(ruleSchema),
      description: 'Replace the conditions an event must match (e.g. source eq facebook).',
    }),
    action({
      code: 'A06',
      name: 'bind_workflow',
      title: 'Bind trigger to workflow',
      effect: 'write',
      description: 'Connect a trigger to the workflow it should start.',
      input: z.object({ triggerId: ref('triggers'), workflowId: ref('workflows') }),
      handler({ triggerId, workflowId }, { db, actor }) {
        const t = db.must('triggers', triggerId);
        db.must('workflows', workflowId);
        if (t.workflowId === workflowId) throw fail.conflict('Trigger is already bound to that workflow');
        return db.update('triggers', t.id, { workflowId }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'enable',
      title: 'Enable trigger',
      effect: 'external',
      description:
        'Enable a trigger so matching events start its workflow. Requires a bound, published workflow.',
      input: z.object({ triggerId: ref('triggers') }),
      handler({ triggerId }, { db, actor }) {
        const t = db.must('triggers', triggerId);
        if (t.enabled) throw fail.conflict(`Trigger ${t.name} is already enabled`);
        if (!t.workflowId) throw fail.state(`Trigger ${t.name} is not bound to a workflow`);
        const w = db.must('workflows', t.workflowId);
        if (w.status !== 'published')
          throw fail.state(`Workflow ${w.name} is ${w.status}; publish it before enabling the trigger`);
        return db.update('triggers', t.id, { enabled: true }, actor);
      },
    }),
    crud.transition({
      code: 'A08',
      name: 'disable',
      title: 'Disable trigger',
      collection: 'triggers',
      idField: 'triggerId',
      field: 'enabled',
      from: [true],
      to: false,
      description: 'Disable a trigger.',
      label: 'Trigger (enabled flag)',
    }),
    action({
      code: 'A09',
      name: 'test',
      title: 'Test trigger with sample event',
      effect: 'read',
      description: 'Dry-run a trigger against a sample event payload and report whether it would fire.',
      input: z.object({ triggerId: ref('triggers'), payload: z.record(z.string(), z.any()).optional() }),
      output: out.shape({ wouldFire: z.boolean(), reasons: z.array(z.string()) }),
      handler({ triggerId, payload = {} }, { db }) {
        const t = db.must('triggers', triggerId);
        const reasons = [];
        if (!t.enabled) reasons.push('trigger is disabled');
        if (!t.workflowId) reasons.push('no workflow bound');
        const failed = t.conditions.filter((c) => !matchRule(payload, c));
        failed.forEach((c) =>
          reasons.push(`condition ${c.field} ${c.op} ${JSON.stringify(c.value)} not met`),
        );
        return {
          triggerId: t.id,
          eventType: t.eventType,
          wouldFire: !reasons.length,
          conditionsMatched: !failed.length,
          reasons,
        };
      },
    }),
    action({
      code: 'A10',
      name: 'firing_history',
      title: 'Get trigger firing history',
      effect: 'read',
      description: 'When a trigger fired and whether the event matched.',
      input: z.object({ triggerId: ref('triggers') }),
      output: out.shape({ triggerId: z.string(), firings: z.array(z.any()) }),
      handler({ triggerId }, { db }) {
        const t = db.must('triggers', triggerId);
        return { triggerId: t.id, firings: [...t.firings].reverse(), count: t.firings.length };
      },
    }),
  ],
};
