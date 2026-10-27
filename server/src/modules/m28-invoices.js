import { z, s, ref, action, crud, fail, listResult, between, norm } from '../core/kit.js';
import { lineItemInput, buildLine, invoiceTotals, daysOverdue } from './_commerce.js';
import { createEmail, deliverEmail } from './m13-email.js';
import { assertCanMessage } from './_shared.js';

const STATUSES = ['draft', 'issued', 'paid', 'void'];
const draft = (i) => {
  if (i.status !== 'draft') throw fail.state(`Invoice ${i.number} is ${i.status}; only drafts can be edited`);
};
const view = (db, clock) => (i) => ({
  ...i,
  daysOverdue: daysOverdue(i, clock),
  contactName: db.get('contacts', i.contactId)?.name ?? null,
});

export default {
  id: 'invoices',
  code: 'M28',
  title: 'Invoices',
  description: 'Issue invoices and track outstanding balances.',
  keywords: [
    'invoice',
    'bill',
    'billing',
    'unpaid',
    'overdue',
    'outstanding',
    'balance',
    'payment reminder',
    'dunning',
    'receivable',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create invoice',
      effect: 'write',
      description: 'Create a draft invoice for a contact, optionally with line items and due date.',
      input: z.object({
        contactId: ref('contacts'),
        lineItems: z.array(lineItemInput).optional(),
        dueDate: s.date('Due date').optional(),
      }),
      handler(a, { db, actor }) {
        db.must('contacts', a.contactId);
        const lineItems = (a.lineItems ?? []).map((l) => buildLine(db, l, 'li'));
        const inv = {
          number: `INV-${1040 + db.col('invoices').length + 1}`,
          contactId: a.contactId,
          lineItems,
          discount: null,
          currency: 'USD',
          tax: 0,
          amountPaid: 0,
          status: 'draft',
          issuedAt: null,
          dueDate: a.dueDate ?? null,
          remindersSent: 0,
          lastReminderAt: null,
          paidAt: null,
        };
        return db.insert('invoices', { ...inv, ...invoiceTotals(inv) }, actor);
      },
    }),
    action({
      code: 'A02',
      name: 'get',
      title: 'Get invoice details',
      effect: 'read',
      description: 'Get an invoice with balance, days overdue and reminder history.',
      input: z.object({ invoiceId: ref('invoices') }),
      handler({ invoiceId }, { db, clock }) {
        const i = db.must('invoices', invoiceId);
        return view(db, clock)(i);
      },
    }),
    action({
      code: 'A03',
      name: 'search',
      title: 'Search invoices',
      effect: 'read',
      description:
        'Search invoices by number, contact(s), status (draft/issued/paid/void), unpaid flag, due date range or minimum days overdue. Results include daysOverdue and balance.',
      input: z.object({
        query: z.string().optional(),
        contactId: ref('contacts').optional(),
        contactIds: z.array(z.string()).optional(),
        status: z.union([z.enum(STATUSES), z.array(z.enum(STATUSES))]).optional(),
        unpaid: z.boolean().optional().meta({ description: 'Only issued invoices with a balance > 0' }),
        minDaysOverdue: z.number().int().min(0).optional(),
        dueFrom: s.datetime('Due on/after').optional(),
        dueTo: s.datetime('Due before').optional(),
        limit: s.limit(),
      }),
      output: z.object({
        items: z.array(z.looseObject({ id: z.string() })),
        total: z.number(),
        returned: z.number(),
      }),
      handler(a, { db, clock }) {
        const st = a.status ? [].concat(a.status) : null;
        const rows = db
          .find(
            'invoices',
            (i) =>
              (!a.query || norm(i.number).includes(norm(a.query))) &&
              (!a.contactId || i.contactId === a.contactId) &&
              (!a.contactIds || a.contactIds.includes(i.contactId)) &&
              (!st || st.includes(i.status)) &&
              (!a.unpaid || (i.status === 'issued' && i.balance > 0)) &&
              (a.minDaysOverdue == null || daysOverdue(i, clock) >= a.minDaysOverdue) &&
              ((!a.dueFrom && !a.dueTo) || between(i.dueDate, a.dueFrom, a.dueTo)),
          )
          .map(view(db, clock));
        return listResult(rows, a.limit ?? 50);
      },
    }),
    action({
      code: 'A04',
      name: 'add_line_item',
      title: 'Add invoice line item',
      effect: 'write',
      description: 'Add a product or custom line to a draft invoice.',
      input: z.object({ invoiceId: ref('invoices') }).extend(lineItemInput.shape),
      handler({ invoiceId, ...item }, { db, actor }) {
        const inv = db.must('invoices', invoiceId);
        draft(inv);
        const lineItems = [...inv.lineItems, buildLine(db, item, 'li')];
        return db.update('invoices', inv.id, { lineItems, ...invoiceTotals({ ...inv, lineItems }) }, actor);
      },
    }),
    action({
      code: 'A05',
      name: 'update_draft',
      title: 'Update draft invoice',
      effect: 'write',
      description: 'Edit a draft invoice: replace line items, set a discount or notes.',
      input: z.object({
        invoiceId: ref('invoices'),
        lineItems: z.array(lineItemInput).optional(),
        discount: z
          .object({ type: z.enum(['percent', 'fixed']), value: z.number().positive() })
          .nullable()
          .optional(),
        notes: z.string().optional(),
      }),
      handler({ invoiceId, lineItems, discount, notes }, { db, actor }) {
        const inv = db.must('invoices', invoiceId);
        draft(inv);
        if (!lineItems && discount === undefined && notes === undefined)
          throw fail.validation('Provide lineItems, discount or notes');
        const next = {
          ...inv,
          ...(lineItems ? { lineItems: lineItems.map((l) => buildLine(db, l, 'li')) } : {}),
          ...(discount !== undefined ? { discount } : {}),
          ...(notes !== undefined ? { notes } : {}),
        };
        return db.update(
          'invoices',
          inv.id,
          {
            lineItems: next.lineItems,
            discount: next.discount,
            notes: next.notes ?? null,
            ...invoiceTotals(next),
          },
          actor,
        );
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_due_date',
      title: 'Set invoice due date',
      collection: 'invoices',
      idField: 'invoiceId',
      field: 'dueDate',
      schema: s.date('Due date'),
      description: "Set or extend an invoice's due date (draft or issued, not paid/void).",
      guard: (i) => {
        if (!['draft', 'issued'].includes(i.status)) throw fail.state(`Invoice ${i.number} is ${i.status}`);
      },
    }),
    action({
      code: 'A07',
      name: 'issue',
      title: 'Issue invoice',
      effect: 'external',
      description:
        'Finalize a draft invoice and send it to the customer. Requires at least one line item; due date defaults to 30 days.',
      input: z.object({ invoiceId: ref('invoices') }),
      handler({ invoiceId }, { db, actor, clock }) {
        const inv = db.must('invoices', invoiceId);
        draft(inv);
        if (!inv.lineItems.length || inv.total <= 0)
          throw fail.state(`Invoice ${inv.number} has no billable line items`);
        return db.update(
          'invoices',
          inv.id,
          {
            status: 'issued',
            issuedAt: clock.nowIso(),
            dueDate: inv.dueDate ?? clock.daysFromNow(30).toISOString(),
          },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'send_reminder',
      title: 'Send invoice reminder',
      effect: 'external',
      description:
        'Email a payment reminder for an issued, unpaid invoice now (uses the invoice reminder template unless a templateId is given).',
      input: z.object({ invoiceId: ref('invoices'), templateId: ref('templates').optional() }),
      handler({ invoiceId, templateId }, ctx) {
        const { db, actor } = ctx;
        const inv = db.must('invoices', invoiceId);
        if (inv.status !== 'issued' || inv.balance <= 0)
          throw fail.state(
            `Invoice ${inv.number} is ${inv.status === 'issued' ? 'fully paid' : inv.status}; no reminder needed`,
          );
        assertCanMessage(db.must('contacts', inv.contactId), 'email');
        const tpl =
          templateId ??
          db.findOne(
            'templates',
            (t) => t.status === 'active' && t.channel === 'email' && /invoice/i.test(t.name),
          )?.id;
        const email = createEmail(
          db,
          {
            contactId: inv.contactId,
            invoiceId: inv.id,
            templateId: tpl,
            category: 'invoice_reminder',
            ...(tpl
              ? {}
              : {
                  subject: `Reminder: invoice ${inv.number}`,
                  body: `Invoice ${inv.number} has a balance of $${inv.balance}.`,
                }),
          },
          actor,
        );
        const sent = deliverEmail(db, email, ctx);
        return { ...db.get('invoices', inv.id), reminderEmailId: sent.id };
      },
    }),
    action({
      code: 'A09',
      name: 'void',
      title: 'Void unpaid invoice',
      effect: 'destructive',
      description: 'Void an invoice that has no payments applied.',
      input: z.object({ invoiceId: ref('invoices'), reason: z.string().optional() }),
      handler({ invoiceId, reason }, { db, actor, clock }) {
        const inv = db.must('invoices', invoiceId);
        if (!['draft', 'issued'].includes(inv.status))
          throw fail.state(`Invoice ${inv.number} is ${inv.status} and cannot be voided`);
        if (inv.amountPaid > 0)
          throw fail.state(
            `Invoice ${inv.number} has ${inv.amountPaid} paid; refund the payment instead of voiding`,
          );
        return db.update(
          'invoices',
          inv.id,
          { status: 'void', voidedAt: clock.nowIso(), voidReason: reason ?? null, balance: 0 },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'list_overdue',
      title: 'List overdue invoices',
      effect: 'read',
      description:
        'List issued, unpaid invoices past their due date, most overdue first, with daysOverdue, balance, contact and last reminder date. Filter by minimum/maximum days overdue.',
      input: z.object({
        minDaysOverdue: z
          .number()
          .int()
          .min(0)
          .optional()
          .meta({ description: 'e.g. 16 for "more than 15 days"' }),
        maxDaysOverdue: z.number().int().min(0).optional(),
        contactId: ref('contacts').optional(),
        contactIds: z.array(z.string()).optional().meta({ description: 'Invoices of any of these contacts' }),
      }),
      output: z.object({
        items: z.array(z.looseObject({ id: z.string() })),
        total: z.number(),
        returned: z.number(),
      }),
      handler({ minDaysOverdue = 1, maxDaysOverdue, contactId, contactIds }, { db, clock }) {
        const rows = db
          .find('invoices', (i) => {
            const d = daysOverdue(i, clock);
            return (
              d >= Math.max(minDaysOverdue, 1) &&
              (maxDaysOverdue == null || d <= maxDaysOverdue) &&
              (!contactId || i.contactId === contactId) &&
              (!contactIds || contactIds.includes(i.contactId))
            );
          })
          .map(view(db, clock))
          .sort((a, b) => b.daysOverdue - a.daysOverdue);
        return listResult(rows, 200);
      },
    }),
  ],
};
