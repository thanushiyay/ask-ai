import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { round2 } from './_commerce.js';

const ACTIVE = ['active', 'trialing', 'paused'];
const notCancelled = (x) => {
  if (x.status === 'cancelled') throw fail.state(`Subscription ${x.id} is cancelled`);
};

export default {
  id: 'subscriptions',
  code: 'M30',
  title: 'Subscriptions',
  description: 'Manage recurring customer billing agreements.',
  keywords: [
    'subscription',
    'recurring',
    'plan',
    'renewal',
    'membership billing',
    'seat',
    'upgrade',
    'downgrade',
    'churn',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create subscription',
      effect: 'write',
      description:
        'Start a recurring subscription for a contact on a recurring price (applies the price trial).',
      input: z.object({
        contactId: ref('contacts'),
        priceId: ref('prices'),
        quantity: z.number().int().min(1).optional(),
      }),
      handler({ contactId, priceId, quantity }, { db, actor, clock }) {
        db.must('contacts', contactId);
        const pr = db.must('prices', priceId);
        if (pr.status !== 'active') throw fail.state('Price is archived');
        if (pr.interval === 'one_time')
          throw fail.validation('Subscriptions need a recurring (month/year) price');
        if (
          db.findOne(
            'subscriptions',
            (x) => x.contactId === contactId && x.productId === pr.productId && ACTIVE.includes(x.status),
          )
        )
          throw fail.conflict(
            'Contact already has an active subscription to this product; change its plan instead',
          );
        const trial = pr.trialDays > 0;
        const start = trial ? clock.daysFromNow(pr.trialDays) : clock.now();
        const periodEnd = new Date(start);
        pr.interval === 'year'
          ? periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1)
          : periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
        return db.insert(
          'subscriptions',
          {
            contactId,
            priceId: pr.id,
            productId: pr.productId,
            quantity: quantity ?? 1,
            status: trial ? 'trialing' : 'active',
            trialEndsAt: trial ? start.toISOString() : null,
            currentPeriodEnd: periodEnd.toISOString(),
            cancelledAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get subscription details',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      description: 'Get a subscription with plan and billing dates.',
      enrich: (x, { db }) => {
        const pr = db.get('prices', x.priceId);
        return {
          planLabel: pr?.label,
          unitAmount: pr?.amount,
          interval: pr?.interval,
          product: db.get('products', x.productId)?.name,
        };
      },
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search subscriptions',
      collection: 'subscriptions',
      description: 'Search subscriptions by contact, product, price or status; or renewal date range.',
      text: [],
      filters: {
        contactId: ref('contacts'),
        productId: ref('products'),
        priceId: ref('prices'),
        status: z.enum(['active', 'trialing', 'paused', 'cancelled']),
      },
      dates: { renews: 'currentPeriodEnd', created: 'createdAt' },
    }),
    action({
      code: 'A04',
      name: 'change_plan',
      title: 'Change subscription plan',
      effect: 'write',
      description: 'Move a subscription to another recurring price (upgrade/downgrade).',
      input: z.object({ subscriptionId: ref('subscriptions'), priceId: ref('prices') }),
      handler({ subscriptionId, priceId }, { db, actor }) {
        const x = db.must('subscriptions', subscriptionId);
        notCancelled(x);
        const pr = db.must('prices', priceId);
        if (pr.status !== 'active' || pr.interval === 'one_time')
          throw fail.validation('Target must be an active recurring price');
        if (pr.id === x.priceId) throw fail.conflict('Subscription is already on that price');
        const old = db.get('prices', x.priceId);
        return {
          ...db.update(
            'subscriptions',
            x.id,
            { priceId: pr.id, productId: pr.productId, previousPriceId: x.priceId },
            actor,
          ),
          change: pr.amount > (old?.amount ?? 0) ? 'upgrade' : 'downgrade',
        };
      },
    }),
    crud.setField({
      code: 'A05',
      name: 'update_quantity',
      title: 'Update subscription quantity',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      field: 'quantity',
      schema: z.number().int().min(1).max(10000),
      description: 'Change the number of seats/units on a subscription.',
      guard: notCancelled,
    }),
    crud.setField({
      code: 'A06',
      name: 'set_trial_end',
      title: 'Set subscription trial end',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      field: 'trialEndsAt',
      schema: s.datetime('New trial end'),
      description: 'Extend or shorten the trial of a trialing subscription.',
      guard: (x, a, { clock }) => {
        if (x.status !== 'trialing') throw fail.state(`Subscription is ${x.status}, not trialing`);
        if (new Date(a.trialEndsAt) <= clock.now()) throw fail.validation('Trial end must be in the future');
      },
    }),
    crud.transition({
      code: 'A07',
      name: 'pause',
      title: 'Pause subscription',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      from: ['active'],
      to: 'paused',
      description: 'Pause billing on an active subscription.',
      patch: (a, r, { clock }) => ({ pausedAt: clock.nowIso() }),
    }),
    crud.transition({
      code: 'A08',
      name: 'resume',
      title: 'Resume subscription',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      from: ['paused'],
      to: 'active',
      description: 'Resume a paused subscription.',
      patch: () => ({ pausedAt: null }),
    }),
    crud.transition({
      code: 'A09',
      name: 'cancel',
      title: 'Cancel subscription',
      collection: 'subscriptions',
      idField: 'subscriptionId',
      from: ['active', 'trialing', 'paused'],
      to: 'cancelled',
      effect: 'destructive',
      extraInput: { reason: z.string().optional() },
      description: 'Cancel a subscription (no further billing).',
      patch: (a, r, { clock }) => ({ cancelledAt: clock.nowIso(), cancelReason: a.reason ?? null }),
    }),
    action({
      code: 'A10',
      name: 'preview_next_invoice',
      title: 'Preview next subscription invoice',
      effect: 'read',
      description: "Preview the amount and date of a subscription's next invoice.",
      input: z.object({ subscriptionId: ref('subscriptions') }),
      output: out.shape({ subscriptionId: z.string(), amount: z.number(), date: z.string().nullable() }),
      handler({ subscriptionId }, { db }) {
        const x = db.must('subscriptions', subscriptionId);
        const pr = db.must('prices', x.priceId);
        if (x.status === 'cancelled')
          return { subscriptionId: x.id, amount: 0, date: null, note: 'Cancelled — no upcoming invoice' };
        if (x.status === 'paused')
          return {
            subscriptionId: x.id,
            amount: 0,
            date: null,
            note: 'Paused — billing resumes when the subscription is resumed',
          };
        return {
          subscriptionId: x.id,
          amount: round2(pr.amount * x.quantity),
          currency: pr.currency,
          date: x.status === 'trialing' ? x.trialEndsAt : x.currentPeriodEnd,
          lines: [
            {
              description: `${db.get('products', x.productId)?.name} — ${pr.label}`,
              quantity: x.quantity,
              unitPrice: pr.amount,
            },
          ],
        };
      },
    }),
  ],
};
