import { z, ref, crud, action, fail, child } from '../core/kit.js';
import { sumLines, round2 } from './_commerce.js';
import { checkCoupon } from './m31-coupons.js';

const draft = (o) => {
  if (o.status !== 'draft') throw fail.state(`Order ${o.id} is ${o.status}; only draft orders can be edited`);
};
const totals = (o) => {
  const subtotal = sumLines(o.lineItems);
  return { subtotal, total: round2(Math.max(subtotal - (o.discount ?? 0), 0)) };
};
function stockOf(p, variantId) {
  return variantId ? child(p.variants, variantId, 'variant').inventory : p.inventory;
}

export default {
  id: 'orders',
  code: 'M32',
  title: 'Orders',
  description: 'Track purchases and fulfillment status.',
  keywords: ['order', 'purchase', 'checkout', 'cart', 'shipping', 'fulfillment', 'ship', 'buy'],
  actions: [
    action({
      code: 'A01',
      name: 'create_draft',
      title: 'Create draft order',
      effect: 'write',
      description: 'Start a draft order for a contact.',
      input: z.object({ contactId: ref('contacts') }),
      handler({ contactId }, { db, actor }) {
        db.must('contacts', contactId);
        return db.insert(
          'orders',
          {
            contactId,
            lineItems: [],
            shippingAddress: null,
            couponCode: null,
            discount: 0,
            subtotal: 0,
            total: 0,
            status: 'draft',
            submittedAt: null,
            fulfilledAt: null,
          },
          actor,
        );
      },
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get order details',
      collection: 'orders',
      idField: 'orderId',
      description: 'Get one order with line items and totals.',
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search orders',
      collection: 'orders',
      description: 'Search orders by contact, status or created date range.',
      text: [],
      filters: {
        contactId: ref('contacts'),
        status: z.enum(['draft', 'submitted', 'fulfilled', 'cancelled']),
      },
    }),
    action({
      code: 'A04',
      name: 'add_line_item',
      title: 'Add order line item',
      effect: 'write',
      description:
        'Add a product (optionally a variant) to a draft order. Checks stock for tracked products.',
      input: z.object({
        orderId: ref('orders'),
        productId: ref('products'),
        variantId: z.string().optional(),
        quantity: z.number().int().min(1).optional(),
      }),
      handler({ orderId, productId, variantId, quantity = 1 }, { db, actor }) {
        const o = db.must('orders', orderId);
        draft(o);
        const p = db.must('products', productId);
        if (p.status !== 'active') throw fail.state(`${p.name} is archived`);
        if (p.trackInventory && stockOf(p, variantId) < quantity)
          throw fail.state(
            `Only ${stockOf(p, variantId)} of ${p.name}${variantId ? ` (${child(p.variants, variantId, 'variant').name})` : ''} in stock`,
          );
        const price =
          db.findOne('prices', (x) => x.productId === p.id && x.isDefault && x.status === 'active')?.amount ??
          p.basePrice;
        const lineItems = [
          ...o.lineItems,
          {
            id: `oli_${db.nextId('_child').split('_').pop()}`,
            productId: p.id,
            variantId: variantId ?? null,
            description: p.name,
            quantity,
            unitPrice: price,
          },
        ];
        return db.update('orders', o.id, { lineItems, ...totals({ ...o, lineItems }) }, actor);
      },
    }),
    action({
      code: 'A05',
      name: 'update_quantity',
      title: 'Update order quantity',
      effect: 'write',
      description: 'Change the quantity of a line on a draft order.',
      input: z.object({
        orderId: ref('orders'),
        lineItemId: z.string().min(1),
        quantity: z.number().int().min(1),
      }),
      handler({ orderId, lineItemId, quantity }, { db, actor }) {
        const o = db.must('orders', orderId);
        draft(o);
        const li = child(o.lineItems, lineItemId, 'line item');
        const p = db.get('products', li.productId);
        if (p?.trackInventory && stockOf(p, li.variantId) < quantity)
          throw fail.state(`Only ${stockOf(p, li.variantId)} in stock`);
        li.quantity = quantity;
        return db.update('orders', o.id, { lineItems: o.lineItems, ...totals(o) }, actor);
      },
    }),
    crud.setField({
      code: 'A06',
      name: 'set_shipping_address',
      title: 'Set order shipping address',
      collection: 'orders',
      idField: 'orderId',
      field: 'shippingAddress',
      schema: z.object({
        line1: z.string().min(1),
        city: z.string().min(1),
        region: z.string().optional(),
        postalCode: z.string().min(1),
        country: z.string().length(2).meta({ description: 'ISO country code' }),
      }),
      description: 'Set where a draft order ships.',
      guard: draft,
    }),
    action({
      code: 'A07',
      name: 'apply_coupon',
      title: 'Apply coupon to order',
      effect: 'write',
      description: 'Apply a coupon code to a draft order (validated).',
      input: z.object({ orderId: ref('orders'), code: z.string().min(1) }),
      handler({ orderId, code }, { db, actor, clock }) {
        const o = db.must('orders', orderId);
        draft(o);
        if (!o.lineItems.length) throw fail.state('Add items before applying a coupon');
        const r = checkCoupon(db, clock, code, o);
        if (!r.valid)
          throw fail.state(`Coupon ${code.toUpperCase()} cannot be applied: ${r.reasons.join(', ')}`, {
            reasons: r.reasons,
          });
        return db.update(
          'orders',
          o.id,
          { couponCode: r.coupon.code, discount: r.discount, ...totals({ ...o, discount: r.discount }) },
          actor,
        );
      },
    }),
    action({
      code: 'A08',
      name: 'submit',
      title: 'Submit order',
      effect: 'external',
      description:
        'Place a draft order: reserves stock, redeems the coupon and notifies the customer. Physical items need a shipping address.',
      input: z.object({ orderId: ref('orders') }),
      handler({ orderId }, { db, actor, clock }) {
        const o = db.must('orders', orderId);
        draft(o);
        if (!o.lineItems.length) throw fail.state('Order has no items');
        const physical = o.lineItems.some((l) => db.get('products', l.productId)?.trackInventory);
        if (physical && !o.shippingAddress)
          throw fail.state('Order contains physical items but has no shipping address');
        for (const l of o.lineItems) {
          const p = db.get('products', l.productId);
          if (p?.trackInventory && stockOf(p, l.variantId) < l.quantity)
            throw fail.state(`Insufficient stock for ${p.name}`);
        }
        for (const l of o.lineItems) {
          const p = db.get('products', l.productId);
          if (!p?.trackInventory) continue;
          if (l.variantId) {
            child(p.variants, l.variantId, 'variant').inventory -= l.quantity;
            db.update('products', p.id, { variants: p.variants }, actor);
          } else db.update('products', p.id, { inventory: p.inventory - l.quantity }, actor);
        }
        if (o.couponCode) {
          const c = db.findOne('coupons', (x) => x.code === o.couponCode);
          if (c) db.update('coupons', c.id, { redemptions: c.redemptions + 1 }, actor);
        }
        return db.update('orders', o.id, { status: 'submitted', submittedAt: clock.nowIso() }, actor);
      },
    }),
    action({
      code: 'A09',
      name: 'cancel',
      title: 'Cancel order',
      effect: 'destructive',
      description: 'Cancel a draft or submitted (unfulfilled) order and restock items.',
      input: z.object({ orderId: ref('orders'), reason: z.string().optional() }),
      handler({ orderId, reason }, { db, actor }) {
        const o = db.must('orders', orderId);
        if (!['draft', 'submitted'].includes(o.status))
          throw fail.state(`Order ${o.id} is ${o.status} and cannot be cancelled`);
        if (o.status === 'submitted')
          for (const l of o.lineItems) {
            const p = db.get('products', l.productId);
            if (!p?.trackInventory) continue;
            if (l.variantId) {
              child(p.variants, l.variantId, 'variant').inventory += l.quantity;
              db.update('products', p.id, { variants: p.variants }, actor);
            } else db.update('products', p.id, { inventory: p.inventory + l.quantity }, actor);
          }
        return db.update('orders', o.id, { status: 'cancelled', cancelReason: reason ?? null }, actor);
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'mark_fulfilled',
      title: 'Mark order fulfilled',
      collection: 'orders',
      idField: 'orderId',
      from: ['submitted'],
      to: 'fulfilled',
      extraInput: { trackingNumber: z.string().optional() },
      description: 'Mark a submitted order as shipped/fulfilled.',
      patch: (a, r, { clock }) => ({ fulfilledAt: clock.nowIso(), trackingNumber: a.trackingNumber ?? null }),
    }),
  ],
};
