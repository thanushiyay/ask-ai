import { z, s, ref, crud, action, fail, child, out } from '../core/kit.js';

const live = (p) => {
  if (p.status !== 'active') throw fail.state(`Product ${p.name} is archived`);
};
const skuTaken = (db, sku, exceptId) =>
  db.findOne(
    'products',
    (p) => p.id !== exceptId && (p.sku === sku || p.variants.some((v) => v.sku === sku)),
  );

export default {
  id: 'products',
  code: 'M25',
  title: 'Products',
  description: 'Manage items offered for purchase.',
  keywords: ['product', 'item', 'sku', 'inventory', 'stock', 'variant', 'catalog', 'merchandise', 'plan'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create product',
      collection: 'products',
      description: 'Create a product (software plan, service or physical item).',
      fields: {
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.enum(['software', 'services', 'physical']),
        basePrice: s.money('Base price'),
        sku: z.string().optional(),
      },
      validate: (a, { db }) => {
        if (a.sku && skuTaken(db, a.sku)) throw fail.conflict(`SKU ${a.sku} is already used`);
      },
      defaults: (a) => ({
        description: '',
        sku: null,
        variants: [],
        inventory: a.category === 'physical' ? 0 : null,
        trackInventory: a.category === 'physical',
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get product details',
      collection: 'products',
      idField: 'productId',
      description: 'Get a product with variants and prices.',
      enrich: (p, { db }) => ({
        prices: db.find('prices', (x) => x.productId === p.id && x.status === 'active'),
      }),
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search products',
      collection: 'products',
      description: 'Search products by name/SKU/description or category.',
      text: ['name', 'sku', 'description'],
      filters: { category: z.enum(['software', 'services', 'physical']) },
      hide: (p) => p.status !== 'active',
    }),
    crud.update({
      code: 'A04',
      name: 'update',
      title: 'Update product details',
      collection: 'products',
      idField: 'productId',
      description: "Update a product's name, description or base price.",
      fields: { name: z.string().min(1), description: z.string(), basePrice: s.money() },
      guard: live,
    }),
    action({
      code: 'A05',
      name: 'archive',
      title: 'Archive product',
      effect: 'destructive',
      description: 'Archive a product. Fails if active subscriptions use it.',
      input: z.object({ productId: ref('products') }),
      handler({ productId }, { db, actor }) {
        const p = db.must('products', productId);
        live(p);
        const subs = db.find(
          'subscriptions',
          (x) => x.productId === p.id && ['active', 'trialing', 'paused'].includes(x.status),
        ).length;
        if (subs)
          throw fail.state(`${subs} active subscriptions use ${p.name}; cancel or migrate them first`);
        return db.update('products', p.id, { status: 'archived' }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'add_variant',
      title: 'Add product variant',
      effect: 'write',
      description: 'Add a variant (size, color...) with its own SKU and stock.',
      input: z.object({
        productId: ref('products'),
        name: z.string().min(1),
        sku: z.string().min(1),
        inventory: z.number().int().min(0).optional(),
      }),
      handler({ productId, name, sku, inventory }, { db, actor }) {
        const p = db.must('products', productId);
        live(p);
        if (skuTaken(db, sku)) throw fail.conflict(`SKU ${sku} is already used`);
        return db.update(
          'products',
          p.id,
          {
            variants: [
              ...p.variants,
              { id: `var_${db.nextId('_child').split('_').pop()}`, name, sku, inventory: inventory ?? 0 },
            ],
          },
          actor,
        );
      },
    }),
    action({
      code: 'A07',
      name: 'update_variant',
      title: 'Update product variant',
      effect: 'write',
      description: 'Rename a variant or change its SKU.',
      input: z.object({
        productId: ref('products'),
        variantId: z.string().min(1),
        name: z.string().optional(),
        sku: z.string().optional(),
      }),
      handler({ productId, variantId, name, sku }, { db, actor }) {
        const p = db.must('products', productId);
        live(p);
        const v = child(p.variants, variantId, 'variant');
        if (sku && sku !== v.sku && skuTaken(db, sku)) throw fail.conflict(`SKU ${sku} is already used`);
        Object.assign(v, name ? { name } : {}, sku ? { sku } : {});
        return db.update('products', p.id, { variants: p.variants }, actor);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'set_sku',
      title: 'Set product SKU',
      collection: 'products',
      idField: 'productId',
      field: 'sku',
      schema: z.string().min(1),
      description: "Set a product's SKU (must be unique).",
      guard: (p, a, { db }) => {
        live(p);
        if (skuTaken(db, a.sku, p.id)) throw fail.conflict(`SKU ${a.sku} is already used`);
      },
    }),
    action({
      code: 'A09',
      name: 'set_inventory',
      title: 'Set inventory quantity',
      effect: 'write',
      description: 'Set stock on hand for a physical product or one of its variants.',
      input: z.object({
        productId: ref('products'),
        quantity: z.number().int().min(0),
        variantId: z.string().optional(),
      }),
      handler({ productId, quantity, variantId }, { db, actor }) {
        const p = db.must('products', productId);
        live(p);
        if (!p.trackInventory)
          throw fail.state(`${p.name} is a ${p.category} product and does not track inventory`);
        if (variantId) {
          child(p.variants, variantId, 'variant').inventory = quantity;
          return db.update('products', p.id, { variants: p.variants }, actor);
        }
        return db.update('products', p.id, { inventory: quantity }, actor);
      },
    }),
    action({
      code: 'A10',
      name: 'inventory_availability',
      title: 'Get inventory availability',
      effect: 'read',
      description:
        'Stock on hand, reserved in submitted orders, and available-to-sell for a product and its variants.',
      input: z.object({ productId: ref('products') }),
      output: out.shape({ productId: z.string(), tracked: z.boolean() }),
      handler({ productId }, { db }) {
        const p = db.must('products', productId);
        if (!p.trackInventory)
          return { productId: p.id, name: p.name, tracked: false, note: 'Not inventory-tracked (unlimited)' };
        const reserved = db
          .find('orders', (o) => o.status === 'submitted')
          .flatMap((o) => o.lineItems)
          .filter((l) => l.productId === p.id)
          .reduce((a, l) => a + l.quantity, 0);
        return {
          productId: p.id,
          name: p.name,
          tracked: true,
          onHand: p.inventory,
          reservedInOpenOrders: reserved,
          available: Math.max(p.inventory - reserved, 0),
          variants: p.variants.map((v) => ({
            id: v.id,
            name: v.name,
            sku: v.sku,
            onHand: v.inventory,
            inStock: v.inventory > 0,
          })),
        };
      },
    }),
  ],
};
