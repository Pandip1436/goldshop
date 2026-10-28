import { Types } from 'mongoose';
import { conflict } from '../lib/errors';
import { logger } from '../lib/logger';
import { InventoryLog, Order, Product } from '../models';

export interface StockLine {
  product: Types.ObjectId;
  variant: Types.ObjectId;
  sku?: string;
  qty: number;
  name?: string;
}

/**
 * Atomically decrements stock for each line. A line only succeeds if the variant still has
 * enough units (the filter and update happen in one document operation), so two shoppers can
 * never buy the last piece twice. If any line fails, earlier lines are put back.
 *
 * MongoDB multi-document transactions need a replica set; this compensation approach works on
 * any deployment, including a standalone server.
 */
export async function reserveStock(lines: StockLine[], orderId?: Types.ObjectId): Promise<void> {
  const done: StockLine[] = [];
  for (const line of lines) {
    const res = await Product.updateOne(
      {
        _id: line.product,
        isActive: true,
        variants: { $elemMatch: { _id: line.variant, isActive: true, stock: { $gte: line.qty } } },
      },
      { $inc: { 'variants.$.stock': -line.qty, totalStock: -line.qty } },
    );
    if (res.modifiedCount !== 1) {
      await restoreStock(done, 'order_cancelled', orderId, 'Rolled back: another item was unavailable');
      throw conflict(
        `${line.name ?? 'An item'} just sold out or has fewer pieces left than you selected. Please review your bag.`,
        'out_of_stock',
      );
    }
    done.push(line);
  }
  await refreshStockFlags(lines.map((l) => l.product));
  await InventoryLog.insertMany(
    lines.map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, delta: -l.qty, reason: 'order', order: orderId })),
  ).catch((err) => logger.warn({ err }, 'inventory log write failed'));
}

async function restoreStock(
  lines: StockLine[],
  reason: 'order_cancelled' | 'reservation_expired' | 'return',
  orderId?: Types.ObjectId,
  note = '',
): Promise<void> {
  for (const line of lines) {
    await Product.updateOne(
      { _id: line.product, 'variants._id': line.variant },
      { $inc: { 'variants.$.stock': line.qty, totalStock: line.qty } },
    );
  }
  if (lines.length) {
    await refreshStockFlags(lines.map((l) => l.product));
    await InventoryLog.insertMany(
      lines.map((l) => ({ product: l.product, variant: l.variant, sku: l.sku, delta: l.qty, reason, order: orderId, note })),
    ).catch((err) => logger.warn({ err }, 'inventory log write failed'));
  }
}

/** Returns an order's stock exactly once, no matter how many times it is called. */
export async function releaseOrderStock(
  orderId: Types.ObjectId,
  reason: 'order_cancelled' | 'reservation_expired' | 'return',
): Promise<boolean> {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, stockReserved: true, stockReleased: false },
    { $set: { stockReleased: true } },
    { new: true },
  ).lean();
  if (!order) return false;
  await restoreStock(
    order.items.map((i) => ({ product: i.product, variant: i.variant, sku: i.sku, qty: i.qty })),
    reason,
    orderId,
  );
  return true;
}

/** Re-reserves stock for an order whose reservation lapsed but whose payment then arrived. */
export async function rereserveOrderStock(orderId: Types.ObjectId): Promise<boolean> {
  const order = await Order.findById(orderId).lean();
  if (!order || !order.stockReleased) return true;
  try {
    await reserveStock(
      order.items.map((i) => ({ product: i.product, variant: i.variant, sku: i.sku, qty: i.qty, name: i.name })),
      orderId,
    );
  } catch {
    return false;
  }
  await Order.updateOne({ _id: orderId }, { $set: { stockReleased: false, stockReserved: true } });
  return true;
}

/** Keeps the denormalised inStock flag in line with the stock counters. */
export async function refreshStockFlags(productIds: Types.ObjectId[]): Promise<void> {
  const ids = [...new Set(productIds.map(String))].map((id) => new Types.ObjectId(id));
  if (!ids.length) return;
  await Product.updateMany({ _id: { $in: ids }, totalStock: { $lte: 0 } }, { $set: { inStock: false } });
  await Product.updateMany({ _id: { $in: ids }, totalStock: { $gt: 0 }, minPrice: { $gt: 0 } }, { $set: { inStock: true } });
}

/** Manual stock adjustment from the admin. Sets an absolute value and logs the delta. */
export async function setVariantStock(
  productId: Types.ObjectId,
  variantId: Types.ObjectId,
  stock: number,
  by: Types.ObjectId,
  note = '',
): Promise<{ before: number; after: number }> {
  const product = await Product.findOne({ _id: productId, 'variants._id': variantId }).select('variants').lean();
  const variant = product?.variants.find((v) => String(v._id) === String(variantId));
  if (!product || !variant) throw conflict('Variant not found', 'not_found');
  const delta = stock - variant.stock;
  // Guard on the value we read so a concurrent order isn't silently overwritten.
  const res = await Product.updateOne(
    { _id: productId, variants: { $elemMatch: { _id: variantId, stock: variant.stock } } },
    { $set: { 'variants.$.stock': stock }, $inc: { totalStock: variant.isActive ? delta : 0 } },
  );
  if (res.modifiedCount !== 1 && delta !== 0) throw conflict('Stock changed while you were editing. Refresh and try again.');
  await refreshStockFlags([productId]);
  if (delta !== 0) {
    await InventoryLog.create({ product: productId, variant: variantId, sku: variant.sku, delta, stockAfter: stock, reason: 'manual', note, by });
  }
  return { before: variant.stock, after: stock };
}
