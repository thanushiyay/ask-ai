import { z, s, ref, crud, action, fail } from '../core/kit.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'];
const live = (p) => {
  if (p.status !== 'active') throw fail.state(`Price ${p.id} is archived`);
};
const inUse = (db, p) =>
  db.find('subscriptions', (x) => x.priceId === p.id && ['active', 'trialing', 'paused'].includes(x.status))
    .length;

export default {
  id: 'prices',
  code: 'M26',
  title: 'Prices',
  description: 'Define product prices and billing intervals.',
  keywords: [
    'price',
    'pricing',
    'cost',
    'billing interval',
    'monthly',
    'annual',
    'trial',
    'currency',
    'plan price',
  ],
  actions: [
    action({
      code: 'A01',
      name: 'create',
      title: 'Create product price',
      effect: 'write',
      description:
        'Add a price to a product (one-time or recurring monthly/yearly), optionally with a trial.',
      input: z.object({
        productId: ref('products'),
        label: z.string().min(1),
        amount: s.money(),
        currency: z.enum(CURRENCIES).optional(),
        interval: z.enum(['one_time', 'month', 'year']),
        trialDays: z.number().int().min(0).max(365).optional(),
      }),
      handler(a, { db, actor }) {
        const p = db.must('products', a.productId);
        if (p.status !== 'active') throw fail.state(`Product ${p.name} is archived`);
        if (a.trialDays && a.interval === 'one_time')
          throw fail.validation('Trials only apply to recurring prices');
        const first = !db.findOne('prices', (x) => x.productId === p.id && x.status === 'active');
        return db.insert(
          'prices',
          {
            productId: p.id,
            label: a.label,
            amount: a.amount,
            currency: a.currency ?? 'USD',
            interval: a.interval,
            trialDays: a.trialDays ?? 0,
            isDefault: first,
            status: 'active',
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get price details',
      collection: 'prices',
      idField: 'priceId',
      description: 'Get one price.',
    }),
    crud.search({
      code: 'A03',
      name: 'list_for_product',
      title: 'List product prices',
      collection: 'prices',
      description: 'List prices, typically for one product.',
      text: ['label'],
      filters: {
        productId: ref('products'),
        interval: z.enum(['one_time', 'month', 'year']),
        currency: z.enum(CURRENCIES),
      },
      hide: (p) => p.status !== 'active',
    }),
    crud.setField({
      code: 'A04',
      name: 'update_label',
      title: 'Update price label',
      collection: 'prices',
      idField: 'priceId',
      field: 'label',
      schema: z.string().min(1),
      description: 'Rename a price (e.g. "Annual – early bird").',
      guard: live,
    }),
    crud.setField({
      code: 'A05',
      name: 'set_amount',
      title: 'Set price amount',
      collection: 'prices',
      idField: 'priceId',
      field: 'amount',
      schema: s.money(),
      description: 'Change a price amount (existing subscriptions keep their rate until renewal).',
      guard: live,
    }),
    crud.setField({
      code: 'A06',
      name: 'set_currency',
      title: 'Set price currency',
      collection: 'prices',
      idField: 'priceId',
      field: 'currency',
      schema: z.enum(CURRENCIES),
      description: "Change a price's currency. Not allowed while subscriptions use it.",
      guard: (p, a, { db }) => {
        live(p);
        if (inUse(db, p))
          throw fail.state(`${inUse(db, p)} subscriptions use this price; create a new price instead`);
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'set_interval',
      title: 'Set billing interval',
      collection: 'prices',
      idField: 'priceId',
      field: 'interval',
      schema: z.enum(['one_time', 'month', 'year']),
      description: "Change a price's billing interval. Not allowed while subscriptions use it.",
      guard: (p, a, { db }) => {
        live(p);
        if (inUse(db, p))
          throw fail.state(`${inUse(db, p)} subscriptions use this price; create a new price instead`);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_trial',
      title: 'Set trial period',
      collection: 'prices',
      idField: 'priceId',
      field: 'trialDays',
      schema: z.number().int().min(0).max(365),
      description: 'Set the free-trial length (days) for a recurring price.',
      guard: (p) => {
        live(p);
        if (p.interval === 'one_time') throw fail.validation('One-time prices cannot have a trial');
      },
    }),
    action({
      code: 'A09',
      name: 'set_default',
      title: 'Set default product price',
      effect: 'write',
      description: 'Make a price the default for its product.',
      input: z.object({ priceId: ref('prices') }),
      handler({ priceId }, { db, actor }) {
        const p = db.must('prices', priceId);
        live(p);
        if (p.isDefault) throw fail.conflict('Price is already the default');
        db.find('prices', (x) => x.productId === p.productId && x.isDefault).forEach((x) =>
          db.update('prices', x.id, { isDefault: false }, actor),
        );
        return db.update('prices', p.id, { isDefault: true }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'archive',
      title: 'Archive price',
      effect: 'destructive',
      description: 'Archive a price. Fails if it is the default or used by active subscriptions.',
      input: z.object({ priceId: ref('prices') }),
      handler({ priceId }, { db, actor }) {
        const p = db.must('prices', priceId);
        live(p);
        if (p.isDefault) throw fail.state('Cannot archive the default price; set another default first');
        if (inUse(db, p)) throw fail.state(`${inUse(db, p)} active subscriptions use this price`);
        return db.update('prices', p.id, { status: 'archived' }, actor);
      },
    }),
  ],
};
