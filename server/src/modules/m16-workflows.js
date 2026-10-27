import { z, ref, crud, action, fail, out, child } from '../core/kit.js';

const STEP_TYPES = [
  'send_email',
  'send_sms',
  'create_task',
  'wait',
  'add_tag',
  'assign_owner',
  'notify_user',
  'branch',
];
const stepConfig = z.record(z.string(), z.any()).meta({
  description:
    'Required settings by step type: create_task {title, dueInDays?}; wait {days or hours}; send_email {templateId, or subject and body}; send_sms {templateId or body}; add_tag {tag}; assign_owner {ownerId}; notify_user {userId, message}. A workflow cannot end with a wait.',
});

const DURATION = /^\s*(\d+(?:\.\d+)?)\s*(m|min|minutes?|h|hrs?|hours?|d|days?|w|weeks?)?\s*$/i;
const WAIT_KEYS = [
  'days',
  'hours',
  'delayDays',
  'waitDays',
  'delay',
  'duration',
  'after',
  'wait',
  'dueInDays',
];

/** Reads a wait duration in the shapes models and people write it: 2, "2", "2d", "48 hours", "1 week". */
function parseWait(config) {
  if (config.hours > 0) return { hours: Number(config.hours) };
  const key = WAIT_KEYS.find((k) => config[k] != null && k !== 'hours');
  if (!key) return null;
  const match = DURATION.exec(String(config[key]));
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'd').toLowerCase();
  if (unit.startsWith('w')) return { days: amount * 7 };
  if (unit.startsWith('h')) return { hours: amount };
  if (unit.startsWith('m')) return { hours: Math.max(amount / 60, 1) };
  return { days: amount };
}

/** Normalizes a step's settings so equivalent ways of saying the same thing are stored the same way. */
function normalizeStep({ type, config = {} }) {
  if (type === 'wait') return { type, config: parseWait(config) ?? config };
  if (type === 'create_task') {
    const dueInDays = config.dueInDays ?? config.dueDays ?? config.delayDays;
    return {
      type,
      config: {
        ...config,
        title: config.title ?? config.name ?? 'Follow up',
        ...(dueInDays != null ? { dueInDays: Number(dueInDays) } : {}),
      },
    };
  }
  return { type, config };
}

function stepProblems(db, st, i) {
  const label = `Step ${i + 1} (${st.type})`;
  const c = st.config ?? {};
  const problems = [];
  if (st.type === 'wait' && !(c.days > 0 || c.hours > 0))
    problems.push(`${label} needs config.days or config.hours, e.g. {"type":"wait","config":{"days":2}}`);
  if (['send_email', 'send_sms'].includes(st.type) && !c.templateId && !c.subject && !c.body)
    problems.push(`${label} needs config.templateId or config.body`);
  if (c.templateId && !db.get('templates', c.templateId))
    problems.push(`${label} references missing template ${c.templateId}`);
  if (st.type === 'create_task' && !c.title) problems.push(`${label} needs config.title`);
  if (st.type === 'add_tag' && !c.tag) problems.push(`${label} needs config.tag`);
  return problems;
}

function validateWorkflow(db, wf) {
  const problems = wf.steps.length
    ? wf.steps.flatMap((st, i) => stepProblems(db, st, i))
    : ['Workflow has no steps'];
  if (wf.steps.at(-1)?.type === 'wait') problems.push('Workflow should not end with a wait step');
  return problems;
}

/** Rejects incomplete steps when they are written, so a plan fails at the step that caused it. */
function assertValidSteps(db, steps, offset = 0) {
  const problems = steps.flatMap((st, i) => stepProblems(db, st, i + offset));
  if (problems.length) throw fail.validation(problems.join('; '), { problems });
}
const editable = (w) => {
  if (w.status === 'published') throw fail.state(`Workflow ${w.name} is published; pause it before editing`);
};

export default {
  id: 'workflows',
  code: 'M16',
  title: 'Workflows',
  description: 'Build and operate multi-step automations.',
  keywords: [
    'workflow',
    'automation',
    'automate',
    'sequence',
    'drip',
    'automatically',
    'every time',
    'whenever',
    'stay on top',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create workflow',
      effect: 'write',
      description:
        'Create a draft automation workflow, optionally with initial steps (send_email, send_sms, create_task, wait, add_tag, assign_owner, notify_user).',
      input: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        steps: z.array(z.object({ type: z.enum(STEP_TYPES), config: stepConfig.optional() })).optional(),
      }),
      handler({ name, description, steps }, { db, actor }) {
        if (db.findOne('workflows', (w) => w.name.toLowerCase() === name.toLowerCase()))
          throw fail.conflict(`Workflow "${name}" exists`);
        const normalized = (steps ?? []).map(normalizeStep);
        assertValidSteps(db, normalized);
        if (normalized.at(-1)?.type === 'wait')
          throw fail.validation('A workflow cannot end with a wait step');
        return db.insert(
          'workflows',
          {
            name,
            description: description ?? '',
            steps: normalized.map((st) => ({
              id: `wstep_${db.nextId('_child').split('_').pop()}`,
              type: st.type,
              config: st.config,
            })),
            status: 'draft',
            executions: [],
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get workflow definition',
      collection: 'workflows',
      idField: 'workflowId',
      description: "Get a workflow's steps and status.",
      enrich: (w, { db }) => ({
        triggers: db
          .find('triggers', (t) => t.workflowId === w.id)
          .map((t) => ({ id: t.id, eventType: t.eventType, enabled: t.enabled })),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'list',
      title: 'List workflows',
      collection: 'workflows',
      description: 'List workflows by name text or status.',
      text: ['name', 'description'],
      filters: { status: z.enum(['draft', 'published', 'paused']) },
    }),
    action({
      code: 'A04',
      name: 'add_step',
      title: 'Add workflow step',
      effect: 'write',
      description: 'Append (or insert at position) a step in a draft/paused workflow.',
      input: z.object({
        workflowId: ref('workflows'),
        type: z.enum(STEP_TYPES),
        config: stepConfig.optional(),
        position: z.number().int().min(1).optional(),
      }),
      handler({ workflowId, type, config, position }, { db, actor }) {
        const w = db.must('workflows', workflowId);
        editable(w);
        const at = (position ?? w.steps.length + 1) - 1;
        const step = normalizeStep({ type, config });
        assertValidSteps(db, [step], at);
        const steps = [...w.steps];
        steps.splice(at, 0, {
          id: `wstep_${db.nextId('_child').split('_').pop()}`,
          type,
          config: step.config,
        });
        return db.update('workflows', w.id, { steps }, actor);
      },
    }),
    action({
      code: 'A05',
      name: 'update_step',
      title: 'Update workflow step',
      effect: 'write',
      description: 'Change the config (or type) of one workflow step.',
      input: z.object({
        workflowId: ref('workflows'),
        stepId: z.string().min(1),
        type: z.enum(STEP_TYPES).optional(),
        config: stepConfig.optional(),
      }),
      handler({ workflowId, stepId, type, config }, { db, actor }) {
        const w = db.must('workflows', workflowId);
        editable(w);
        const st = child(w.steps, stepId, 'workflow step');
        if (type) st.type = type;
        if (config) st.config = { ...st.config, ...config };
        return db.update('workflows', w.id, { steps: w.steps }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'remove_step',
      title: 'Remove workflow step',
      effect: 'destructive',
      description: 'Remove a step from a draft/paused workflow.',
      input: z.object({ workflowId: ref('workflows'), stepId: z.string().min(1) }),
      handler({ workflowId, stepId }, { db, actor }) {
        const w = db.must('workflows', workflowId);
        editable(w);
        child(w.steps, stepId, 'workflow step');
        return db.update('workflows', w.id, { steps: w.steps.filter((x) => x.id !== stepId) }, actor);
      },
    }),
    action({
      code: 'A07',
      name: 'validate',
      title: 'Validate workflow',
      effect: 'read',
      description: 'Check a workflow for configuration problems before publishing.',
      input: z.object({ workflowId: ref('workflows') }),
      output: out.shape({ workflowId: z.string(), valid: z.boolean(), problems: z.array(z.string()) }),
      handler({ workflowId }, { db }) {
        const w = db.must('workflows', workflowId);
        const p = validateWorkflow(db, w);
        return { workflowId: w.id, valid: !p.length, problems: p };
      },
    }),
    action({
      code: 'A08',
      name: 'publish',
      title: 'Publish workflow',
      effect: 'external',
      description:
        'Publish (activate) a workflow so it runs on live records. Fails if validation finds problems.',
      input: z.object({ workflowId: ref('workflows') }),
      handler({ workflowId }, { db, actor, clock }) {
        const w = db.must('workflows', workflowId);
        if (w.status === 'published') throw fail.conflict(`Workflow ${w.name} is already published`);
        const p = validateWorkflow(db, w);
        if (p.length) throw fail.state(`Workflow ${w.name} is invalid: ${p.join('; ')}`, { problems: p });
        return db.update('workflows', w.id, { status: 'published', publishedAt: clock.nowIso() }, actor);
      },
    }),
    crud.transition({
      code: 'A09',
      name: 'pause',
      title: 'Pause workflow',
      collection: 'workflows',
      idField: 'workflowId',
      from: ['published'],
      to: 'paused',
      description: 'Pause a published workflow.',
    }),
    action({
      code: 'A10',
      name: 'execution_history',
      title: 'Get workflow execution history',
      effect: 'read',
      description: 'Recent executions of a workflow with success/failure counts.',
      input: z.object({ workflowId: ref('workflows'), status: z.enum(['success', 'failed']).optional() }),
      output: out.shape({
        workflowId: z.string(),
        executions: z.array(z.any()),
        counts: z.record(z.string(), z.number()),
      }),
      handler({ workflowId, status }, { db }) {
        const w = db.must('workflows', workflowId);
        const ex = w.executions.filter((e) => !status || e.status === status);
        return {
          workflowId: w.id,
          executions: ex,
          counts: {
            total: w.executions.length,
            success: w.executions.filter((e) => e.status === 'success').length,
            failed: w.executions.filter((e) => e.status === 'failed').length,
          },
        };
      },
    }),
  ],
};
