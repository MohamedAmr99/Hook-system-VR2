import type { Purchase, PurchaseItem } from "../types/purchase.types";

/**
 * Pure stock / weighted-average-cost math for purchases. No Firestore access here so it can be
 * unit tested. All user-facing error messages are Arabic.
 */

export interface ProductStockSnapshot {
  name: string;
  quantity: number;
  costPrice: number;
  reservedQuantity: number;
  unavailableQuantity: number;
}

export interface ProductAggregate {
  qty: number;
  value: number;
}

export interface ProductStockChange {
  productId: string;
  qtyDelta: number;
  valueDelta: number;
  previousStock: number;
  previousWac: number;
  newStock: number;
  newWac: number;
}

/** Tolerance for floating point noise when value would drop slightly below zero. */
const VALUE_EPSILON = 0.01;

/** Stock + cost effect of a purchase: only a Received purchase has added stock. */
export function effectiveItems(purchase: Purchase | null): PurchaseItem[] {
  if (!purchase || purchase.status !== "Received") return [];
  return purchase.items.filter((i) => i.productId && Number(i.orderedQuantity) > 0);
}

/** Sums quantity and purchase value (qty * unitCost) per product. */
export function aggregateByProduct(items: PurchaseItem[]): Map<string, ProductAggregate> {
  const map = new Map<string, ProductAggregate>();
  for (const item of items) {
    const qty = Number(item.orderedQuantity) || 0;
    const unitCost = Number(item.unitCost) || 0;
    const agg = map.get(item.productId) ?? { qty: 0, value: 0 };
    agg.qty += qty;
    agg.value += qty * unitCost;
    map.set(item.productId, agg);
  }
  return map;
}

/**
 * Net effect on one product of replacing the `oldAgg` receipt with the `newAgg` receipt.
 * Only the FINAL state is validated (not the intermediate reversed state), so e.g. editing the
 * notes of a Received purchase whose stock was partly sold succeeds.
 * Returns null when the net change is zero (nothing to write).
 */
export function computeNetChange(
  productId: string,
  stock: ProductStockSnapshot,
  oldAgg: ProductAggregate,
  newAgg: ProductAggregate,
  opts: { legacy?: boolean } = {},
): ProductStockChange | null {
  const qtyDelta = newAgg.qty - oldAgg.qty;
  const valueDelta = newAgg.value - oldAgg.value;
  if (qtyDelta === 0 && Math.abs(valueDelta) < 1e-9) return null;

  const previousStock = stock.quantity;
  const newStock = previousStock + qtyDelta;

  if (opts.legacy) {
    // Legacy (local-only) receipt reversal: only the quantity is subtracted. The old code
    // overwrote costPrice = unitCost instead of blending, so the WAC cannot be reversed
    // reliably; we deliberately keep the product's current costPrice and never throw on WAC math.
    const available = previousStock - stock.reservedQuantity - stock.unavailableQuantity;
    const required = -qtyDelta;
    if (newStock < 0 || newStock - stock.reservedQuantity - stock.unavailableQuantity < 0) {
      throw new Error(legacyShortageMessage(stock.name, available, required));
    }
    return {
      productId,
      qtyDelta,
      valueDelta,
      previousStock,
      previousWac: stock.costPrice,
      newStock,
      newWac: stock.costPrice,
    };
  }

  if (newStock < 0) {
    throw new Error(
      `لا يمكن تعديل الاستلام: المخزون الحالي للمنتج "${stock.name}" (${previousStock}) أقل من الكمية المطلوب خصمها (${-qtyDelta}).`,
    );
  }
  if (newStock - stock.reservedQuantity - stock.unavailableQuantity < 0) {
    throw new Error(
      `لا يمكن تعديل الاستلام: الكمية المحجوزة للمنتج "${stock.name}" تتجاوز المخزون المتبقي.`,
    );
  }

  // Guard against corrupt negative stock when computing the existing inventory value.
  const baseValue = Math.max(0, previousStock) * stock.costPrice;
  const newValue = baseValue + valueDelta;
  if (newValue < -VALUE_EPSILON) {
    throw new Error(
      `لا يمكن تعديل الاستلام: سيصبح متوسط التكلفة للمنتج "${stock.name}" سالبًا. راجع أسعار التكلفة.`,
    );
  }

  // Keep the previous WAC when there is no stock left (avoids division by zero).
  const newWac = newStock > 0 ? Math.max(0, newValue) / newStock : stock.costPrice;

  return {
    productId,
    qtyDelta,
    valueDelta,
    previousStock,
    previousWac: stock.costPrice,
    newStock,
    newWac,
  };
}

/** Arabic error when the available stock cannot cover the quantity to be deducted. */
export function legacyShortageMessage(name: string, available: number, required: number): string {
  return `المنتج "${name}": المتاح ${available} أقل من الكمية المطلوب خصمها ${required} — عدّل كمية المنتج أو غيّر حالة الأمر أولاً.`;
}
