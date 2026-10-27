import { z, ref, crud, action, fail, out } from '../core/kit.js';
import { render } from './_shared.js';

const vars = (t) => [
  ...new Set(
    `${t.subject ?? ''} ${t.body}`.match(/\{\{\s*([\w.]+)\s*\}\}/g)?.map((m) => m.replace(/[{}\s]/g, '')) ??
      [],
  ),
];
const live = (t) => {
  if (t.status !== 'active') throw fail.state(`Template ${t.name} is archived`);
};
const SAMPLE = {
  first_name: 'Jane',
  last_name: 'Doe',
  full_name: 'Jane Doe',
  invoice_number: 'INV-0000',
  amount_due: '$120.00',
  due_date: '2026-10-01',
  review_link: 'https://reviews.example/r',
  appointment_title: 'Discovery Call',
  appointment_time: '10:00',
};

export default {
  id: 'templates',
  code: 'M14',
  title: 'Message Templates',
  description: 'Manage reusable email and SMS content.',
  keywords: [
    'template',
    'message template',
    'canned response',
    'snippet',
    'email template',
    'sms template',
    'variables',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create message template',
      effect: 'write',
      description: 'Create a reusable email or SMS template. Use {{variable}} placeholders.',
      input: z.object({
        name: z.string().min(1),
        channel: z.enum(['email', 'sms']),
        subject: z.string().optional(),
        body: z.string().min(1),
      }),
      handler(a, { db, actor, clock }) {
        if (a.channel === 'email' && !a.subject) throw fail.validation('Email templates need a subject');
        if (
          db.findOne(
            'templates',
            (t) => t.name.toLowerCase() === a.name.toLowerCase() && t.status === 'active',
          )
        )
          throw fail.conflict(`Template "${a.name}" exists`);
        const t = { ...a, subject: a.subject ?? null };
        return db.insert(
          'templates',
          {
            ...t,
            variables: vars(t),
            versions: [{ version: 1, subject: t.subject, body: t.body, at: clock.nowIso() }],
            version: 1,
            status: 'active',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get template',
      collection: 'templates',
      idField: 'templateId',
      description: 'Get a template with its content and variables.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search templates',
      collection: 'templates',
      description: 'Search templates by name/content text and channel.',
      text: ['name', 'subject', 'body'],
      filters: { channel: z.enum(['email', 'sms']) },
      hide: (t) => t.status !== 'active',
    }),
    action({
      code: 'A04',
      name: 'update_content',
      title: 'Update template content',
      effect: 'write',
      description: "Update a template's subject/body; creates a new version.",
      input: z.object({
        templateId: ref('templates'),
        subject: z.string().optional(),
        body: z.string().min(1).optional(),
      }),
      handler({ templateId, subject, body }, { db, actor, clock }) {
        const t = db.must('templates', templateId);
        live(t);
        if (!subject && !body) throw fail.validation('Provide subject or body');
        const next = { subject: subject ?? t.subject, body: body ?? t.body };
        const version = t.version + 1;
        return db.update(
          'templates',
          t.id,
          {
            ...next,
            variables: vars(next),
            version,
            versions: [...t.versions, { version, ...next, at: clock.nowIso() }],
          },
          actor,
        );
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'archive',
      title: 'Archive template',
      collection: 'templates',
      idField: 'templateId',
      from: ['active'],
      to: 'archived',
      effect: 'destructive',
      description: 'Archive a template.',
    }),
    action({
      code: 'A06',
      name: 'duplicate',
      title: 'Duplicate template',
      effect: 'write',
      description: 'Copy a template under a new name.',
      input: z.object({ templateId: ref('templates'), name: z.string().optional() }),
      handler({ templateId, name }, { db, actor, clock }) {
        const t = db.must('templates', templateId);
        return db.insert(
          'templates',
          {
            name: name ?? `${t.name} (copy)`,
            channel: t.channel,
            subject: t.subject,
            body: t.body,
            variables: t.variables,
            versions: [{ version: 1, subject: t.subject, body: t.body, at: clock.nowIso() }],
            version: 1,
            status: 'active',
          },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'define_variables',
      title: 'Define template variables',
      effect: 'write',
      description: 'Declare the variables a template expects (with optional default values).',
      input: z.object({
        templateId: ref('templates'),
        variables: z.array(z.string().min(1)).min(1),
        defaults: z.record(z.string(), z.string()).optional(),
      }),
      handler({ templateId, variables, defaults }, { db, actor }) {
        const t = db.must('templates', templateId);
        live(t);
        return db.update(
          'templates',
          t.id,
          {
            variables: [...new Set(variables)],
            variableDefaults: { ...(t.variableDefaults ?? {}), ...(defaults ?? {}) },
          },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'validate_variables',
      title: 'Validate template variables',
      effect: 'read',
      description:
        'Check that every placeholder used in a template is declared, and every declared variable is used.',
      input: z.object({ templateId: ref('templates') }),
      output: out.shape({ valid: z.boolean(), undeclared: z.array(z.string()), unused: z.array(z.string()) }),
      handler({ templateId }, { db }) {
        const t = db.must('templates', templateId);
        const used = vars(t);
        const undeclared = used.filter((v) => !t.variables.includes(v));
        const unused = t.variables.filter((v) => !used.includes(v));
        return { templateId: t.id, valid: !undeclared.length, undeclared, unused, used };
      },
    }),
    action({
      code: 'A09',
      name: 'render_sample',
      title: 'Render template with sample data',
      effect: 'read',
      description: 'Render a template with sample data (or supplied variables) to preview it.',
      input: z.object({
        templateId: ref('templates'),
        variables: z.record(z.string(), z.string()).optional(),
      }),
      output: out.shape({ subject: z.string().nullable(), body: z.string(), missing: z.array(z.string()) }),
      handler({ templateId, variables }, { db }) {
        const t = db.must('templates', templateId);
        const v = { ...SAMPLE, ...(t.variableDefaults ?? {}), ...(variables ?? {}) };
        const s = t.subject ? render(t.subject, v) : { text: null, missing: [] };
        const b = render(t.body, v);
        return {
          templateId: t.id,
          subject: s.text,
          body: b.text,
          missing: [...new Set([...s.missing, ...b.missing])],
        };
      },
    }),
    action({
      code: 'A10',
      name: 'restore_version',
      title: 'Restore template version',
      effect: 'write',
      description: 'Restore an earlier version of a template (saved as a new version).',
      input: z.object({ templateId: ref('templates'), version: z.number().int().min(1) }),
      handler({ templateId, version }, { db, actor, clock }) {
        const t = db.must('templates', templateId);
        const v = t.versions.find((x) => x.version === version);
        if (!v)
          throw fail.notFound(
            'template version',
            `${version} (available: ${t.versions.map((x) => x.version).join(', ')})`,
          );
        if (version === t.version) throw fail.conflict(`Version ${version} is already current`);
        const nv = t.version + 1;
        return db.update(
          'templates',
          t.id,
          {
            subject: v.subject,
            body: v.body,
            version: nv,
            status: 'active',
            versions: [
              ...t.versions,
              { version: nv, subject: v.subject, body: v.body, at: clock.nowIso(), restoredFrom: version },
            ],
          },
          actor,
        );
      },
    }),
  ],
};
