import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { round2 } from './_commerce.js';

const pendingFor = (db, paymentId, exceptId) =>
  round2(
    db
      .find(
        'refunds',
        (r) => r.paymentId === paymentId && r.id !== exceptId && ['requested', 'approved'].includes(r.status),
      )
      .reduce((a, r) => a + r.amount, 0),
  );
const refundable = (db, p, exceptId) => round2(p.amount - p.refundedAmount - pendingFor(db, p.id, exceptId));
const open = (r) => {
  if (!['requested', 'approved'].includes(r.status)) throw fail.state(`Refund ${r.id} is ${r.status}`);
};

export default {
  id: 'refunds',
  code: 'M33',
  title: 'Refunds',
  description: 'Manage refund requests against recorded payments.',
  keywords: ['refund', 'money back', 'reimburse', 'chargeback', 'return payment'],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create refund request',
      effect: 'write',
      description: 'Request a full or partial refund of a successful payment.',
      input: z.object({
        paymentId: ref('payments'),
        amount: s.money().optional().meta({ description: 'Default: full refundable amount' }),
        reason: z.string().min(3),
      }),
      handler({ paymentId, amount, reason }, { db, actor }) {
        const p = db.must('payments', paymentId);
        if (p.status !== 'succeeded')
          throw fail.state(`Payment ${p.id} ${p.status}; only successful payments can be refunded`);
        const max = refundable(db, p);
        const amt = amount ?? max;
        if (max <= 0) throw fail.state('Nothing left to refund on this payment');
        if (amt > max) throw fail.validation(`Only ${max} is refundable on this payment`);
        return db.insert(
          'refunds',
          {
            paymentId: p.id,
            contactId: p.contactId,
            amount: amt,
            reason,
            status: 'requested',
            executedAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get refund request',
      collection: 'refunds',
      idField: 'refundId',
      description: 'Get one refund request.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search refund requests',
      collection: 'refunds',
      description: 'Search refund requests by contact, payment or status.',
      text: ['reason'],
      filters: {
        contactId: ref('contacts'),
        paymentId: ref('payments'),
        status: z.enum(['requested', 'approved', 'rejected', 'executed']),
      },
    }),
    crud.setField({
      code: 'A04',
      name: 'set_reason',
      title: 'Set refund reason',
      collection: 'refunds',
      idField: 'refundId',
      field: 'reason',
      schema: z.string().min(3),
      description: 'Update the reason on an open refund request.',
      guard: open,
    }),
    crud.setField({
      code: 'A05',
      name: 'set_partial_amount',
      title: 'Set partial refund amount',
      collection: 'refunds',
      idField: 'refundId',
      field: 'amount',
      schema: s.money(),
      description: 'Change the amount of an open refund request (cannot exceed the refundable balance).',
      guard: (r, a, { db }) => {
        open(r);
        const max = refundable(db, db.must('payments', r.paymentId), r.id);
        if (a.amount <= 0 || a.amount > max) throw fail.validation(`Amount must be between 0 and ${max}`);
      },
    }),
    action({
      code: 'A06',
      name: 'refundable_balance',
      title: 'Check refundable balance',
      effect: 'read',
      description: 'How much of a payment can still be refunded (after executed and pending refunds).',
      input: z.object({ paymentId: ref('payments') }),
      output: out.shape({ paymentId: z.string(), refundable: z.number() }),
      handler({ paymentId }, { db }) {
        const p = db.must('payments', paymentId);
        return {
          paymentId: p.id,
          paid: p.amount,
          alreadyRefunded: p.refundedAmount,
          pending: pendingFor(db, p.id),
          refundable: p.status === 'succeeded' ? refundable(db, p) : 0,
        };
      },
    }),
    crud.transition({
      code: 'A07',
      name: 'approve',
      title: 'Approve refund request',
      collection: 'refunds',
      idField: 'refundId',
      from: ['requested'],
      to: 'approved',
      description: 'Approve a refund request (it still needs executing).',
      patch: (a, r, { clock }) => ({ approvedAt: clock.nowIso() }),
    }),
    crud.transition({
      code: 'A08',
      name: 'reject',
      title: 'Reject refund request',
      collection: 'refunds',
      idField: 'refundId',
      from: ['requested', 'approved'],
      to: 'rejected',
      extraInput: { reason: z.string().optional() },
      description: 'Reject a refund request.',
      patch: (a) => ({ rejectionReason: a.reason ?? null }),
    }),
    action({
      code: 'A09',
      name: 'execute',
      title: 'Execute simulated refund',
      effect: 'external',
      description: 'Send the money back to the customer for an approved refund (simulated processor).',
      input: z.object({ refundId: ref('refunds') }),
      handler({ refundId }, { db, actor, clock }) {
        const r = db.must('refunds', refundId);
        if (r.status !== 'approved')
          throw fail.state(`Refund ${r.id} is ${r.status}; it must be approved before executing`);
        const p = db.must('payments', r.paymentId);
        if (round2(p.amount - p.refundedAmount) < r.amount)
          throw fail.state('Refund exceeds the remaining paid amount');
        db.update('payments', p.id, { refundedAmount: round2(p.refundedAmount + r.amount) }, actor);
        return db.update(
          'refunds',
          r.id,
          {
            status: 'executed',
            executedAt: clock.nowIso(),
            processorReference: `re_sim_${r.id.split('_')[1]}`,
          },
          actor,
        );
      },
    }),
    action({
      code: 'A10',
      name: 'execution_status',
      title: 'Get refund execution status',
      effect: 'read',
      description: 'Where a refund is in its lifecycle and when the customer should see the money.',
      input: z.object({ refundId: ref('refunds') }),
      output: out.shape({ refundId: z.string(), status: z.string() }),
      handler({ refundId }, { db, clock }) {
        const r = db.must('refunds', refundId);
        return {
          refundId: r.id,
          status: r.status,
          amount: r.amount,
          executedAt: r.executedAt,
          expectedSettlement: r.executedAt ? clock.date(clock.addDays(new Date(r.executedAt), 5)) : null,
          next: {
            requested: 'Needs approval',
            approved: 'Ready to execute',
            executed: 'Done — funds are on their way',
            rejected: 'No action',
          }[r.status],
        };
      },
    }),
  ],
};
