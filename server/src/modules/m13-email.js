import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { appendMessage, render, contactVars, assertCanMessage } from './_shared.js';

const EMAIL_CATEGORIES = [
  'general',
  'follow_up',
  'invoice_reminder',
  'marketing',
  'transactional',
  'review_request',
];

// Default template per purpose, so "draft a reminder for this invoice" works without naming a template.
const DEFAULT_TEMPLATE = [
  [(a) => a.invoiceId || a.category === 'invoice_reminder', /invoice/i],
  [(a) => a.category === 'review_request', /review/i],
  [(a) => a.category === 'follow_up', /follow.?up/i],
];

function defaultTemplateId(db, a) {
  const match = DEFAULT_TEMPLATE.find(([applies]) => applies(a));
  if (!match) return null;
  return (
    db.findOne('templates', (t) => t.channel === 'email' && t.status === 'active' && match[1].test(t.name))
      ?.id ?? null
  );
}

function availableTemplates(db) {
  return db
    .find('templates', (t) => t.channel === 'email' && t.status === 'active')
    .map((t) => `${t.id} "${t.name}"`)
    .join(', ');
}

function composeEmail(db, input) {
  const a =
    input.subject && input.body
      ? input
      : { ...input, templateId: input.templateId ?? defaultTemplateId(db, input) };
  let { subject, body } = a;
  if (a.templateId) {
    const t = db.must('templates', a.templateId);
    if (t.channel !== 'email') throw fail.validation(`Template ${t.name} is an ${t.channel} template`);
    if (t.status !== 'active') throw fail.state(`Template ${t.name} is archived`);
    const vars = contactVars(db, a.contactId, { invoiceId: a.invoiceId, variables: a.variables });
    const rs = render(t.subject, vars);
    const rb = render(t.body, vars);
    const missing = [...new Set([...rs.missing, ...rb.missing])];
    if (missing.length) throw fail.validation(`Missing template variables: ${missing.join(', ')}`);
    subject = subject ?? rs.text;
    body = body ?? rb.text;
  }
  if (!subject || !body) {
    throw fail.validation(
      `Provide subject and body, or a templateId (email templates: ${availableTemplates(db)})`,
    );
  }
  return { subject, body };
}

export function createEmail(db, a, actor, status = 'draft') {
  const c = db.must('contacts', a.contactId);
  if (a.invoiceId) db.must('invoices', a.invoiceId);
  const { subject, body } = composeEmail(db, a);
  return db.insert(
    'emails',
    {
      contactId: c.id,
      to: c.email,
      from: 'team@northwind.example',
      subject,
      body,
      status,
      category: a.category ?? (a.invoiceId ? 'invoice_reminder' : 'general'),
      direction: 'outbound',
      invoiceId: a.invoiceId ?? null,
      templateId: a.templateId ?? null,
      scheduledAt: null,
      sentAt: null,
      deliveryStatus: null,
      openedAt: null,
    },
    actor,
  );
}

export function deliverEmail(db, email, { actor, clock }) {
  const c = db.must('contacts', email.contactId);
  assertCanMessage(c, 'email');
  const at = clock.nowIso();
  appendMessage(
    db,
    {
      contactId: c.id,
      channel: 'email',
      direction: 'outbound',
      body: `${email.subject}\n\n${email.body}`,
      at,
    },
    actor,
  );
  const sent = db.update(
    'emails',
    email.id,
    {
      status: 'sent',
      sentAt: at,
      deliveryStatus: c.email.endsWith('.invalid') ? 'bounced' : 'delivered',
      to: c.email,
    },
    actor,
  );
  if (email.invoiceId && email.category === 'invoice_reminder') {
    const inv = db.get('invoices', email.invoiceId);
    if (inv)
      db.update(
        'invoices',
        inv.id,
        { remindersSent: (inv.remindersSent ?? 0) + 1, lastReminderAt: at },
        actor,
      );
  }
  return sent;
}

const composeInput = {
  contactId: ref('contacts'),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  templateId: ref('templates', 'Email template to render (fills subject/body)').optional(),
  invoiceId: ref('invoices', 'Related invoice (enables invoice template variables)').optional(),
  category: z.enum(EMAIL_CATEGORIES).optional(),
  variables: z.record(z.string(), z.string()).optional().meta({ description: 'Extra template variables' }),
};

export default {
  id: 'email',
  code: 'M13',
  title: 'Email',
  description: 'Prepare, send, and track email messages.',
  keywords: ['email', 'e-mail', 'mail', 'inbox', 'unsubscribe', 'reminder email', 'newsletter'],
  actions: [
    action({
      code: 'A01',
      name: 'draft',
      title: 'Draft email',
      effect: 'write',
      description:
        'Create a draft email to a contact from subject/body or a template. With invoiceId (or a category such as invoice_reminder) the matching template is used automatically. Nothing is sent.',
      input: z.object(composeInput),
      handler: (a, { db, actor }) => createEmail(db, a, actor),
    }),
    action({
      code: 'A02',
      name: 'preview',
      title: 'Preview email',
      effect: 'read',
      description:
        'Render an email (draft ID, or contact + template/subject/body) without saving or sending it.',
      input: z.object({
        emailId: ref('emails').optional(),
        ...Object.fromEntries(Object.entries(composeInput).map(([k, v]) => [k, v.optional()])),
      }),
      output: out.shape({ to: z.string().nullable(), subject: z.string(), body: z.string() }),
      handler(a, { db }) {
        if (a.emailId) {
          const e = db.must('emails', a.emailId);
          return { to: e.to, subject: e.subject, body: e.body, status: e.status };
        }
        if (!a.contactId) throw fail.validation('Provide emailId or contactId');
        const c = db.must('contacts', a.contactId);
        return { to: c.email, ...composeEmail(db, a) };
      },
    }),
    action({
      code: 'A03',
      name: 'send',
      title: 'Send email',
      effect: 'external',
      description:
        'Send an email now: an existing draft (emailId) or a new one (contact + subject/body or template; with invoiceId the invoice reminder template is used automatically). Respects unsubscribes.',
      input: z.object({
        emailId: ref('emails').optional(),
        ...Object.fromEntries(Object.entries(composeInput).map(([k, v]) => [k, v.optional()])),
      }),
      handler(a, ctx) {
        const { db, actor } = ctx;
        let email;
        if (a.emailId) {
          email = db.must('emails', a.emailId);
          if (!['draft', 'scheduled'].includes(email.status))
            throw fail.state(`Email ${email.id} is already ${email.status}`);
        } else {
          if (!a.contactId) throw fail.validation('Provide emailId or contactId');
          assertCanMessage(db.must('contacts', a.contactId), 'email');
          email = createEmail(db, a, actor);
        }
        return deliverEmail(db, email, ctx);
      },
    }),
    action({
      code: 'A04',
      name: 'schedule',
      title: 'Schedule email',
      effect: 'external',
      description: 'Schedule a draft email for a future time.',
      input: z.object({ emailId: ref('emails'), sendAt: s.datetime('Future send time') }),
      handler({ emailId, sendAt }, { db, actor, clock }) {
        const e = db.must('emails', emailId);
        if (e.status !== 'draft')
          throw fail.state(`Email ${e.id} is ${e.status}; only drafts can be scheduled`);
        if (new Date(sendAt) <= clock.now()) throw fail.validation('sendAt must be in the future');
        assertCanMessage(db.must('contacts', e.contactId), 'email');
        return db.update('emails', e.id, { status: 'scheduled', scheduledAt: sendAt }, actor);
      },
    }),
    crud.transition({
      code: 'A05',
      name: 'cancel_scheduled',
      title: 'Cancel scheduled email',
      collection: 'emails',
      idField: 'emailId',
      from: ['scheduled'],
      to: 'cancelled',
      effect: 'destructive',
      description: 'Cancel a scheduled email.',
    }),
    crud.get({
      code: 'A06',
      name: 'get',
      title: 'Get email details',
      collection: 'emails',
      idField: 'emailId',
      description: 'Get one email by ID.',
    }),
    crud.search({
      code: 'A07',
      name: 'search',
      title: 'Search email messages',
      collection: 'emails',
      description:
        'Search emails by subject/body text, contact(s), status, category (e.g. invoice_reminder), related invoice, or sent date range. Use to check who was already emailed/reminded in a period.',
      text: ['subject', 'body'],
      filters: {
        contactId: ref('contacts'),
        status: z.union([
          z.enum(['draft', 'scheduled', 'sent', 'cancelled', 'received']),
          z.array(z.enum(['draft', 'scheduled', 'sent', 'cancelled', 'received'])),
        ]),
        category: z.enum(EMAIL_CATEGORIES),
        invoiceId: ref('invoices'),
        direction: z.enum(['inbound', 'outbound']),
      },
      dates: { sent: 'sentAt', created: 'createdAt' },
      extraInput: {
        contactIds: z.array(z.string()).optional().meta({ description: 'Emails for any of these contacts' }),
      },
      where: (e, a) => !a.contactIds || a.contactIds.includes(e.contactId),
    }),
    action({
      code: 'A08',
      name: 'delivery_status',
      title: 'Get email delivery status',
      effect: 'read',
      description: 'Delivery/open status of an email.',
      input: z.object({ emailId: ref('emails') }),
      output: out.shape({ emailId: z.string(), status: z.string() }),
      handler({ emailId }, { db }) {
        const e = db.must('emails', emailId);
        return {
          emailId: e.id,
          status: e.status,
          deliveryStatus: e.deliveryStatus,
          sentAt: e.sentAt,
          opened: Boolean(e.openedAt),
        };
      },
    }),
    action({
      code: 'A09',
      name: 'receive_inbound',
      title: 'Receive simulated inbound email',
      effect: 'write',
      description: 'Simulate an incoming email reply from a contact (added to their conversation).',
      input: z.object({
        contactId: ref('contacts'),
        subject: z.string().optional(),
        body: z.string().min(1),
      }),
      handler({ contactId, subject, body }, { db, actor, clock }) {
        const c = db.must('contacts', contactId);
        const at = clock.nowIso();
        const conv = appendMessage(
          db,
          { contactId: c.id, channel: 'email', direction: 'inbound', body, at },
          actor,
        );
        return db.insert(
          'emails',
          {
            contactId: c.id,
            to: 'team@northwind.example',
            from: c.email,
            subject: subject ?? `Re: ${conv.subject}`,
            body,
            status: 'received',
            category: 'general',
            direction: 'inbound',
            invoiceId: null,
            templateId: null,
            sentAt: at,
            deliveryStatus: 'delivered',
            conversationId: conv.id,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'record_unsubscribe',
      title: 'Record email unsubscribe',
      effect: 'write',
      description: 'Unsubscribe a contact from email; scheduled emails to them are cancelled.',
      input: z.object({ contactId: ref('contacts') }),
      handler({ contactId }, { db, actor }) {
        const c = db.must('contacts', contactId);
        if (c.commPrefs.email === 'unsubscribed') throw fail.conflict(`${c.name} is already unsubscribed`);
        const sched = db.find('emails', (e) => e.contactId === c.id && e.status === 'scheduled');
        sched.forEach((e) => db.update('emails', e.id, { status: 'cancelled' }, actor));
        return {
          ...db.update('contacts', c.id, { commPrefs: { ...c.commPrefs, email: 'unsubscribed' } }, actor),
          cancelledScheduled: sched.length,
        };
      },
    }),
  ],
};
