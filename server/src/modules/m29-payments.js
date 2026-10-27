import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { applyToInvoice, round2 } from './_commerce.js';

const allocated = (p) => round2(p.allocations.reduce((a, x) => a + x.amount, 0));

export default {
  id: 'payments',
  code: 'M29',
  title: 'Payments',
  description: 'Track payment attempts and invoice settlement.',
  keywords: [
    'payment',
    'paid',
    'pay',
    'charge',
    'receipt',
    'transaction',
    'payment link',
    'declined',
    'failed payment',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create_request',
      title: 'Create payment request',
      effect: 'write',
      description: 'Create a payment link for a contact, for an invoice balance or a custom amount.',
      input: z.object({
        contactId: ref('contacts'),
        invoiceId: ref('invoices').optional(),
        amount: s.money().optional(),
      }),
      handler({ contactId, invoiceId, amount }, { db, actor, clock }) {
        db.must('contacts', contactId);
        let amt = amount;
        if (invoiceId) {
          const inv = db.must('invoices', invoiceId);
          if (inv.contactId !== contactId)
            throw fail.validation(`Invoice ${inv.number} belongs to a different contact`);
          if (inv.status !== 'issued' || inv.balance <= 0)
            throw fail.state(`Invoice ${inv.number} is ${inv.status} with balance ${inv.balance}`);
          amt ??= inv.balance;
          if (amt > inv.balance) throw fail.validation(`Amount exceeds invoice balance ${inv.balance}`);
        }
        if (!amt) throw fail.validation('Provide an amount or an invoiceId');
        const r = db.insert(
          'payment_requests',
          {
            contactId,
            invoiceId: invoiceId ?? null,
            amount: amt,
            currency: 'USD',
            status: 'pending',
            expiresAt: clock.daysFromNow(14).toISOString(),
          },
          actor,
        );
        return db.update(
          'payment_requests',
          r.id,
          { link: `https://pay.northwind.example/r/${r.id}` },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get_request',
      title: 'Get payment request',
      collection: 'payment_requests',
      idField: 'paymentRequestId',
      description: 'Get a payment request and its status.',
    }),
    crud.transition({
      code: 'A03',
      name: 'cancel_request',
      title: 'Cancel unpaid payment request',
      collection: 'payment_requests',
      idField: 'paymentRequestId',
      from: ['pending'],
      to: 'cancelled',
      effect: 'destructive',
      description: 'Cancel a pending (unpaid) payment request; the link stops working.',
    }),
    action({
      code: 'A04',
      name: 'record',
      title: 'Record simulated payment',
      effect: 'write',
      description:
        'Record a payment from a contact (simulated processor). If invoiceId is given it is applied to that invoice. outcome=failed simulates a decline.',
      input: z.object({
        contactId: ref('contacts'),
        amount: s.money(),
        method: z.enum(['card', 'bank_transfer', 'cash', 'check']).optional(),
        invoiceId: ref('invoices').optional(),
        paymentRequestId: ref('payment_requests').optional(),
        outcome: z.enum(['succeeded', 'failed']).optional(),
      }),
      handler(a, { db, actor, clock }) {
        db.must('contacts', a.contactId);
        if (a.amount <= 0) throw fail.validation('Amount must be positive');
        const failed = a.outcome === 'failed';
        if (a.invoiceId && !failed) {
          const inv = db.must('invoices', a.invoiceId);
          if (inv.contactId !== a.contactId)
            throw fail.validation(`Invoice ${inv.number} belongs to a different contact`);
        }
        const p = db.insert(
          'payments',
          {
            contactId: a.contactId,
            amount: a.amount,
            currency: 'USD',
            method: a.method ?? 'card',
            status: failed ? 'failed' : 'succeeded',
            failureReason: failed ? 'card_declined: do_not_honor' : null,
            allocations: [],
            refundedAmount: 0,
            processedAt: clock.nowIso(),
            reference: `ch_sim_${db.col('payments').length + 1}`,
          },
          actor,
        );
        if (!failed && a.invoiceId) {
          applyToInvoice(db, a.invoiceId, a.amount, actor, clock);
          p.allocations.push({ invoiceId: a.invoiceId, amount: a.amount });
        }
        if (!failed && a.paymentRequestId)
          db.update(
            'payment_requests',
            db.must('payment_requests', a.paymentRequestId).id,
            { status: 'paid', paymentId: p.id },
            actor,
          );
        return p;
      },
    }),
    crud.get({
      code: 'A05',
      name: 'get',
      title: 'Get payment details',
      collection: 'payments',
      idField: 'paymentId',
      description: 'Get a payment with allocations and refunds.',
      enrich: (p) => ({
        unallocated: round2(p.amount - allocated(p)),
        refundable: round2(p.amount - p.refundedAmount),
      }),
    }),
    crud.search({
      code: 'A06',
      name: 'search',
      title: 'Search payments',
      collection: 'payments',
      description: 'Search payments by contact, status (succeeded/failed), method or processed date range.',
      text: ['reference'],
      filters: {
        contactId: ref('contacts'),
        status: z.enum(['succeeded', 'failed']),
        method: z.enum(['card', 'bank_transfer', 'cash', 'check']),
      },
      dates: { processed: 'processedAt' },
    }),
    action({
      code: 'A07',
      name: 'allocate',
      title: 'Allocate payment to invoice',
      effect: 'write',
      description: 'Apply (part of) an unallocated payment to an invoice of the same contact.',
      input: z.object({
        paymentId: ref('payments'),
        invoiceId: ref('invoices'),
        amount: s.money().optional(),
      }),
      handler({ paymentId, invoiceId, amount }, { db, actor, clock }) {
        const p = db.must('payments', paymentId);
        if (p.status !== 'succeeded')
          throw fail.state(`Payment ${p.id} ${p.status}; only successful payments can be allocated`);
        const inv = db.must('invoices', invoiceId);
        if (inv.contactId !== p.contactId)
          throw fail.validation('Payment and invoice belong to different contacts');
        const free = round2(p.amount - allocated(p) - p.refundedAmount);
        const amt = amount ?? Math.min(free, inv.balance);
        if (amt <= 0 || amt > free + 0.001)
          throw fail.validation(`Only ${free} of this payment is unallocated`);
        applyToInvoice(db, inv.id, amt, actor, clock);
        return db.update(
          'payments',
          p.id,
          { allocations: [...p.allocations, { invoiceId: inv.id, amount: amt }] },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'remove_allocation',
      title: 'Remove payment allocation',
      effect: 'write',
      description: 'Un-apply a payment from an invoice (the invoice balance goes back up).',
      input: z.object({ paymentId: ref('payments'), invoiceId: ref('invoices') }),
      handler({ paymentId, invoiceId }, { db, actor }) {
        const p = db.must('payments', paymentId);
        const al = p.allocations.find((x) => x.invoiceId === invoiceId);
        if (!al) throw fail.state('This payment is not allocated to that invoice');
        const inv = db.must('invoices', invoiceId);
        const amountPaid = round2(inv.amountPaid - al.amount);
        db.update(
          'invoices',
          inv.id,
          {
            amountPaid,
            balance: round2(inv.total - amountPaid),
            status: inv.status === 'paid' ? 'issued' : inv.status,
            paidAt: null,
          },
          actor,
        );
        return db.update('payments', p.id, { allocations: p.allocations.filter((x) => x !== al) }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'generate_receipt',
      title: 'Generate payment receipt',
      effect: 'write',
      description: 'Generate a receipt document for a successful payment.',
      input: z.object({ paymentId: ref('payments') }),
      handler({ paymentId }, { db, actor }) {
        const p = db.must('payments', paymentId);
        if (p.status !== 'succeeded') throw fail.state(`Cannot issue a receipt for a ${p.status} payment`);
        const existing = db.findOne('receipts', (r) => r.paymentId === p.id);
        if (existing) return existing;
        const c = db.get('contacts', p.contactId);
        const r = db.insert(
          'receipts',
          {
            paymentId: p.id,
            contactId: p.contactId,
            amount: p.amount,
            currency: p.currency,
            number: `RCPT-${5000 + db.col('receipts').length + 1}`,
            lines: p.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
            billedTo: c?.name ?? null,
          },
          actor,
        );
        return db.update(
          'receipts',
          r.id,
          { url: `https://files.northwind.example/receipts/${r.number}.pdf` },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'failure_details',
      title: 'Get payment failure details',
      effect: 'read',
      description: 'Explain why a payment failed and suggest next steps.',
      input: z.object({ paymentId: ref('payments') }),
      output: out.shape({ paymentId: z.string(), failed: z.boolean() }),
      handler({ paymentId }, { db }) {
        const p = db.must('payments', paymentId);
        if (p.status !== 'failed') return { paymentId: p.id, failed: false, status: p.status };
        const [code, detail] = p.failureReason.split(': ');
        const advice =
          {
            card_declined:
              'Ask the customer to use a different card or contact their bank; you can send a new payment request.',
          }[code] ?? 'Retry later or request another payment method.';
        return {
          paymentId: p.id,
          failed: true,
          code,
          detail,
          amount: p.amount,
          contactId: p.contactId,
          advice,
        };
      },
    }),
  ],
};
