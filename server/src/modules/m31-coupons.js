import { z, s, ref, crud, action, fail, out } from '../core/kit.js';
import { sumLines, discountAmount } from './_commerce.js';

export function checkCoupon(db, clock, code, order) {
  const c = db.findOne('coupons', (x) => x.code.toUpperCase() === code.toUpperCase());
  const reasons = [];
  if (!c) return { valid: false, reasons: [`Coupon ${code} does not exist`] };
  if (c.status !== 'active') reasons.push('coupon is deactivated');
  if (c.validFrom && new Date(c.validFrom) > clock.now())
    reasons.push(`not valid until ${c.validFrom.slice(0, 10)}`);
  if (c.validTo && new Date(c.validTo) < clock.now()) reasons.push(`expired on ${c.validTo.slice(0, 10)}`);
  if (c.redemptionLimit != null && c.redemptions >= c.redemptionLimit)
    reasons.push('redemption limit reached');
  let eligible = order ? order.lineItems : [];
  if (order && c.productIds.length) {
    eligible = order.lineItems.filter((l) => c.productIds.includes(l.productId));
    if (!eligible.length) reasons.push('no items in the order are eligible for this coupon');
  }
  const discount =
    order && !reasons.length ? discountAmount(sumLines(eligible), { type: c.type, value: c.value }) : 0;
  return { valid: !reasons.length, coupon: c, reasons, discount };
}

export default {
  id: 'coupons',
  code: 'M31',
  title: 'Coupons',
  description: 'Configure and validate promotional discounts.',
  keywords: ['coupon', 'discount code', 'promo code', 'voucher', 'promotion', 'deal code'],
  actions: [
    crud.create({
      code: 'A01',
      name: 'create',
      title: 'Create coupon',
      collection: 'coupons',
      description: 'Create a percent or fixed-amount coupon code.',
      fields: {
        code: z
          .string()
          .regex(/^[A-Za-z0-9_-]{3,20}$/)
          .meta({ description: 'Code customers type, e.g. SPRING25' }),
        type: z.enum(['percent', 'fixed']),
        value: z.number().positive(),
        description: z.string().optional(),
        validTo: s.datetime('Expiry').optional(),
        redemptionLimit: z.number().int().min(1).optional(),
      },
      validate(a, { db }) {
        a.code = a.code.toUpperCase();
        if (a.type === 'percent' && a.value > 100)
          throw fail.validation('Percent discount cannot exceed 100');
        if (db.findOne('coupons', (c) => c.code === a.code))
          throw fail.conflict(`Coupon ${a.code} already exists`);
      },
      defaults: (a, { clock }) => ({
        description: '',
        validFrom: clock.nowIso(),
        validTo: null,
        redemptionLimit: null,
        redemptions: 0,
        productIds: [],
        status: 'active',
      }),
    }),
    crud.get({
      code: 'A02',
      name: 'get',
      title: 'Get coupon details',
      collection: 'coupons',
      idField: 'couponId',
      description: "Get a coupon's rules and redemption count.",
    }),
    crud.search({
      code: 'A03',
      name: 'search',
      title: 'Search coupons',
      collection: 'coupons',
      description: 'Search coupons by code/description or status.',
      text: ['code', 'description'],
      filters: { status: z.enum(['active', 'inactive']), type: z.enum(['percent', 'fixed']) },
    }),
    crud.setField({
      code: 'A04',
      name: 'update_description',
      title: 'Update coupon description',
      collection: 'coupons',
      idField: 'couponId',
      field: 'description',
      schema: z.string(),
      description: 'Update the internal description of a coupon.',
    }),
    action({
      code: 'A05',
      name: 'set_discount_value',
      title: 'Set discount value',
      effect: 'write',
      description: "Change a coupon's discount type/value.",
      input: z.object({
        couponId: ref('coupons'),
        type: z.enum(['percent', 'fixed']).optional(),
        value: z.number().positive(),
      }),
      handler({ couponId, type, value }, { db, actor }) {
        const c = db.must('coupons', couponId);
        const t = type ?? c.type;
        if (t === 'percent' && value > 100) throw fail.validation('Percent discount cannot exceed 100');
        return db.update('coupons', c.id, { type: t, value }, actor);
      },
    }),
    action({
      code: 'A06',
      name: 'set_validity_window',
      title: 'Set coupon validity window',
      effect: 'write',
      description: 'Set the dates a coupon is valid.',
      input: z.object({
        couponId: ref('coupons'),
        validFrom: s.datetime('Start').optional(),
        validTo: s.datetime('End').optional(),
      }),
      handler({ couponId, validFrom, validTo }, { db, actor }) {
        const c = db.must('coupons', couponId);
        const from = validFrom ?? c.validFrom;
        const to = validTo ?? c.validTo;
        if (from && to && new Date(to) <= new Date(from))
          throw fail.validation('validTo must be after validFrom');
        return db.update('coupons', c.id, { validFrom: from, validTo: to }, actor);
      },
    }),
    crud.setField({
      code: 'A07',
      name: 'set_redemption_limit',
      title: 'Set redemption limit',
      collection: 'coupons',
      idField: 'couponId',
      field: 'redemptionLimit',
      schema: z.number().int().min(1).nullable(),
      description: 'Set the maximum number of redemptions (null = unlimited).',
      guard: (c, a) => {
        if (a.redemptionLimit != null && a.redemptionLimit < c.redemptions)
          throw fail.validation(`Already redeemed ${c.redemptions} times`);
      },
    }),
    crud.setField({
      code: 'A08',
      name: 'restrict_to_products',
      title: 'Restrict coupon to products',
      collection: 'coupons',
      idField: 'couponId',
      field: 'productIds',
      schema: z.array(ref('products')),
      description: 'Limit a coupon to specific products (empty = all products).',
      guard: (c, a, { db }) => a.productIds.forEach((id) => db.must('products', id)),
    }),
    action({
      code: 'A09',
      name: 'validate_for_order',
      title: 'Validate coupon for order',
      effect: 'read',
      description: 'Check whether a coupon code can be applied to an order and how much it would discount.',
      input: z.object({ code: z.string().min(1), orderId: ref('orders') }),
      output: out.shape({ valid: z.boolean(), reasons: z.array(z.string()), discount: z.number() }),
      handler({ code, orderId }, { db, clock }) {
        const order = db.must('orders', orderId);
        const r = checkCoupon(db, clock, code, order);
        return {
          code: code.toUpperCase(),
          orderId,
          valid: r.valid,
          reasons: r.reasons,
          discount: r.discount ?? 0,
        };
      },
    }),
    crud.transition({
      code: 'A10',
      name: 'deactivate',
      title: 'Deactivate coupon',
      collection: 'coupons',
      idField: 'couponId',
      from: ['active'],
      to: 'inactive',
      effect: 'destructive',
      description: 'Deactivate a coupon so it can no longer be redeemed.',
    }),
  ],
};
