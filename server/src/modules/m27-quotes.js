import { z, s, ref, crud, action, fail, child } from '../core/kit.js';
import { lineItemInput, buildLine, sumLines, discountAmount, round2 } from './_commerce.js';

const totals = (q) => {
  const subtotal = sumLines(q.lineItems);
  return { subtotal, total: round2(subtotal - discountAmount(subtotal, q.discount)) };
};
const draft = (q) => {
  if (q.status !== 'draft') throw fail.state(`Quote ${q.number} is ${q.status}; only drafts can be edited`);
};

export default {
  id: 'quotes',
  code: 'M27',
  title: 'Quotes',
  description: 'Prepare proposed purchases for customer acceptance.',
  keywords: ['quote', 'proposal', 'estimate', 'offer', 'quotation', 'line item', 'accept'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create quote',
      effect: 'write',
      description: 'Create a draft quote for a contact, optionally with line items.',
      input: z.object({
        contactId: ref('contacts'),
        lineItems: z.array(lineItemInput).optional(),
        expiresAt: s.date('Expiry date').optional(),
      }),
      handler(a, { db, actor, clock }) {
        db.must('contacts', a.contactId);
        const lineItems = (a.lineItems ?? []).map((l) => buildLine(db, l, 'qli'));
        const n = db.col('quotes').length + 2001;
        const q = {
          contactId: a.contactId,
          number: `Q-${n}`,
          lineItems,
          discount: null,
          expiresAt: a.expiresAt ?? clock.date(clock.daysFromNow(30)),
          status: 'draft',
          acceptedAt: null,
          invoiceId: null,
        };
        return db.insert('quotes', { ...q, ...totals(q) }, actor);
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get quote details',
      collection: 'quotes',
      idField: 'quoteId',
      description: 'Get one quote by ID.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search quotes',
      collection: 'quotes',
      description: 'Search quotes by number, contact or status.',
      text: ['number'],
      filters: {
        contactId: ref('contacts'),
        status: z.enum(['draft', 'sent', 'accepted', 'converted', 'expired']),
      },
    }),
    action({
      code: 'A04',
      name: 'add_line_item',
      title: 'Add quote line item',
      effect: 'write',
      description: 'Add a product or custom line to a draft quote.',
      input: z.object({ quoteId: ref('quotes') }).extend(lineItemInput.shape),
      handler({ quoteId, ...item }, { db, actor }) {
        const q = db.must('quotes', quoteId);
        draft(q);
        const lineItems = [...q.lineItems, buildLine(db, item, 'qli')];
        return db.update('quotes', q.id, { lineItems, ...totals({ ...q, lineItems }) }, actor);
      },
    }),
    action({
      code: 'A05',
      name: 'update_line_item',
      title: 'Update quote line item',
      effect: 'write',
      description: 'Change quantity, price or description of a line on a draft quote.',
      input: z.object({
        quoteId: ref('quotes'),
        lineItemId: z.string().min(1),
        quantity: z.number().positive().optional(),
        unitPrice: z.number().nonnegative().optional(),
        description: z.string().optional(),
      }),
      handler({ quoteId, lineItemId, ...p }, { db, actor }) {
        const q = db.must('quotes', quoteId);
        draft(q);
        const li = child(q.lineItems, lineItemId, 'line item');
        Object.entries(p).forEach(([k, v]) => v !== undefined && (li[k] = v));
        return db.update('quotes', q.id, { lineItems: q.lineItems, ...totals(q) }, actor);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_expiry',
      title: 'Set quote expiry',
      collection: 'quotes',
      idField: 'quoteId',
      field: 'expiresAt',
      schema: s.date('Expiry date'),
      description: 'Set when a quote expires.',
      guard: (q, a, { clock }) => {
        if (['accepted', 'converted'].includes(q.status)) throw fail.state(`Quote is ${q.status}`);
        if (new Date(a.expiresAt) < clock.startOfDay(clock.now()))
          throw fail.validation('Expiry must be today or later');
      },
    }),
    action({
      code: 'A07',
      name: 'apply_discount',
      title: 'Apply quote discount',
      effect: 'write',
      description: 'Apply a percent or fixed discount to a draft quote.',
      input: z.object({
        quoteId: ref('quotes'),
        type: z.enum(['percent', 'fixed']),
        value: z.number().positive(),
      }),
      handler({ quoteId, type, value }, { db, actor }) {
        const q = db.must('quotes', quoteId);
        draft(q);
        if (type === 'percent' && value > 100) throw fail.validation('Percent discount cannot exceed 100');
        const discount = { type, value };
        return db.update('quotes', q.id, { discount, ...totals({ ...q, discount }) }, actor);
      },
    }),
    action({
      code: 'A08',
      name: 'send',
      title: 'Send quote for acceptance',
      effect: 'external',
      description: 'Email a draft quote to the customer for acceptance.',
      input: z.object({ quoteId: ref('quotes') }),
      handler({ quoteId }, { db, actor, clock }) {
        const q = db.must('quotes', quoteId);
        draft(q);
        if (!q.lineItems.length) throw fail.state(`Quote ${q.number} has no line items`);
        const c = db.must('contacts', q.contactId);
        if (!c.email) throw fail.validation(`${c.name} has no email address`);
        return db.update(
          'quotes',
          q.id,
          { status: 'sent', sentAt: clock.nowIso(), url: `https://quotes.northwind.example/${q.number}` },
          actor,
        );
      },
    }),
    action({
      code: 'A09',
      name: 'record_acceptance',
      title: 'Record quote acceptance',
      effect: 'write',
      description: 'Record that the customer accepted a sent quote (fails if expired).',
      input: z.object({ quoteId: ref('quotes') }),
      handler({ quoteId }, { db, actor, clock }) {
        const q = db.must('quotes', quoteId);
        if (q.status !== 'sent')
          throw fail.state(`Quote ${q.number} is ${q.status}; only sent quotes can be accepted`);
        if (q.expiresAt && new Date(q.expiresAt) < clock.startOfDay(clock.now())) {
          db.update('quotes', q.id, { status: 'expired' }, actor);
          throw fail.state(`Quote ${q.number} expired on ${q.expiresAt.slice(0, 10)}`);
        }
        return db.update('quotes', q.id, { status: 'accepted', acceptedAt: clock.nowIso() }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'convert_to_invoice',
      title: 'Convert accepted quote to invoice',
      effect: 'write',
      description: 'Create a draft invoice from an accepted quote.',
      input: z.object({ quoteId: ref('quotes') }),
      handler({ quoteId }, { db, actor }) {
        const q = db.must('quotes', quoteId);
        if (q.status !== 'accepted')
          throw fail.state(`Quote ${q.number} is ${q.status}; only accepted quotes can be invoiced`);
        const n = 1040 + db.col('invoices').length + 1;
        const inv = db.insert(
          'invoices',
          {
            number: `INV-${n}`,
            contactId: q.contactId,
            lineItems: structuredClone(q.lineItems),
            discount: q.discount,
            currency: 'USD',
            subtotal: q.subtotal,
            tax: 0,
            total: q.total,
            amountPaid: 0,
            balance: q.total,
            status: 'draft',
            issuedAt: null,
            dueDate: null,
            remindersSent: 0,
            lastReminderAt: null,
            paidAt: null,
            quoteId: q.id,
          },
          actor,
        );
        db.update('quotes', q.id, { status: 'converted', invoiceId: inv.id }, actor);
        return inv;
      },
    }),
  ],
};
