import { z, ref, fail } from '../core/kit.js';

export const round2 = (n) => Math.round(n * 100) / 100;
export const sumLines = (items) => round2(items.reduce((a, l) => a + l.quantity * l.unitPrice, 0));

export const lineItemInput = z.object({
  productId: ref('products').optional(),
  description: z.string().optional().meta({ description: 'Defaults to the product name' }),
  quantity: z.number().positive().optional().meta({ description: 'Default 1' }),
  unitPrice: z
    .number()
    .nonnegative()
    .optional()
    .meta({ description: 'Defaults to the product default price' }),
});

export function buildLine(db, item, prefix) {
  let { description, unitPrice } = item;
  if (item.productId) {
    const p = db.must('products', item.productId);
    if (p.status !== 'active') throw fail.state(`Product ${p.name} is archived`);
    description ??= p.name;
    unitPrice ??=
      db.findOne('prices', (pr) => pr.productId === p.id && pr.isDefault && pr.status === 'active')?.amount ??
      p.basePrice;
  }
  if (!description || unitPrice == null)
    throw fail.validation('Line items need a productId, or a description and unitPrice');
  return {
    id: `${prefix}_${db.nextId('_child').split('_').pop()}`,
    productId: item.productId ?? null,
    description,
    quantity: item.quantity ?? 1,
    unitPrice,
  };
}

export function discountAmount(subtotal, discount) {
  if (!discount) return 0;
  return round2(
    discount.type === 'percent' ? (subtotal * discount.value) / 100 : Math.min(discount.value, subtotal),
  );
}

/** Recompute derived invoice money fields after any change. */
export function invoiceTotals(inv) {
  const subtotal = sumLines(inv.lineItems);
  const total = round2(subtotal - discountAmount(subtotal, inv.discount) + (inv.tax ?? 0));
  return { subtotal, total, balance: round2(total - (inv.amountPaid ?? 0)) };
}

export const daysOverdue = (inv, clock) =>
  inv.status === 'issued' && inv.balance > 0 && inv.dueDate && new Date(inv.dueDate) < clock.now()
    ? Math.floor((clock.now() - new Date(inv.dueDate)) / 86_400_000)
    : 0;

/** Apply money to an invoice and mark it paid when the balance hits zero. */
export function applyToInvoice(db, invoiceId, amount, actor, clock) {
  const inv = db.must('invoices', invoiceId);
  if (inv.status !== 'issued')
    throw fail.state(
      `Invoice ${inv.number} is ${inv.status}; payments can only be applied to issued invoices`,
    );
  if (amount > inv.balance + 0.001)
    throw fail.validation(`Amount ${amount} exceeds the invoice balance of ${inv.balance}`);
  const amountPaid = round2(inv.amountPaid + amount);
  const balance = round2(inv.total - amountPaid);
  return db.update(
    'invoices',
    inv.id,
    { amountPaid, balance, ...(balance <= 0 ? { status: 'paid', paidAt: clock.nowIso() } : {}) },
    actor,
  );
}
