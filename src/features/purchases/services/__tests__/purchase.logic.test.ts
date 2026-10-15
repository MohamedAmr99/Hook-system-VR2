import { describe, it, expect } from "vitest";
import type { Purchase, PurchaseItem } from "../../types/purchase.types";
import {
  aggregateByProduct,
  computeNetChange,
  effectiveItems,
  ProductStockSnapshot,
} from "../purchase.logic";

const line = (qty: number, unitCost: number, productId = "p1"): PurchaseItem => ({
  id: `${productId}-${qty}`,
  productId,
  sku: "SKU",
  name: "Item",
  orderedQuantity: qty,
  receivedQuantity: 0,
  unitCost,
});

const purchase = (status: Purchase["status"], items: PurchaseItem[]): Purchase =>
  ({ id: "pur1", status, items }) as Purchase;

const stock = (over: Partial<ProductStockSnapshot> = {}): ProductStockSnapshot => ({
  name: "Prod",
  quantity: 0,
  costPrice: 0,
  reservedQuantity: 0,
  unavailableQuantity: 0,
  ...over,
});

/** Mirrors what commitPurchase does for a single product. */
const net = (s: ProductStockSnapshot, before: Purchase | null, after: Purchase | null) =>
  computeNetChange(
    "p1",
    s,
    aggregateByProduct(effectiveItems(before)).get("p1") ?? { qty: 0, value: 0 },
    aggregateByProduct(effectiveItems(after)).get("p1") ?? { qty: 0, value: 0 },
  );

describe("purchase stock/WAC net change", () => {
  it("Pending -> Received adds stock and blends WAC", () => {
    const before = purchase("Pending", [line(10, 20)]);
    const after = purchase("Received", [line(10, 20)]);
    const c = net(stock({ quantity: 10, costPrice: 10 }), before, after)!;
    expect(c.qtyDelta).toBe(10);
    expect(c.newStock).toBe(20);
    expect(c.newWac).toBeCloseTo(15);
  });

  it("Received -> Pending reverses stock and WAC", () => {
    const before = purchase("Received", [line(10, 20)]);
    const after = purchase("Pending", [line(10, 20)]);
    const c = net(stock({ quantity: 20, costPrice: 15 }), before, after)!;
    expect(c.qtyDelta).toBe(-10);
    expect(c.newStock).toBe(10);
    expect(c.newWac).toBeCloseTo(10);
  });

  it("Received edit with partially sold stock succeeds when quantities are unchanged", () => {
    // received 100, shipped 60 -> 40 left; editing notes keeps the same lines
    const p = purchase("Received", [line(100, 5)]);
    const edited = purchase("Received", [line(100, 5)]);
    expect(net(stock({ quantity: 40, costPrice: 5 }), p, edited)).toBeNull();
  });

  it("Received edit that raises quantity validates only the final state", () => {
    const before = purchase("Received", [line(100, 5)]);
    const after = purchase("Received", [line(120, 5)]);
    const c = net(stock({ quantity: 40, costPrice: 5 }), before, after)!;
    expect(c.qtyDelta).toBe(20);
    expect(c.newStock).toBe(60);
    expect(c.newWac).toBeCloseTo(5);
  });

  it("rejects reducing below what was already sold", () => {
    const before = purchase("Received", [line(100, 5)]);
    const after = purchase("Received", [line(30, 5)]);
    expect(() => net(stock({ quantity: 40, costPrice: 5 }), before, after)).toThrow(/أقل من الكمية/);
  });

  it("rejects when reserved stock would exceed remaining stock", () => {
    const before = purchase("Received", [line(10, 5)]);
    const after = purchase("Pending", [line(10, 5)]);
    expect(() => net(stock({ quantity: 12, costPrice: 5, reservedQuantity: 5 }), before, after)).toThrow(
      /المحجوزة/,
    );
  });

  it("counts unavailableQuantity in the availability guard", () => {
    const before = purchase("Received", [line(10, 5)]);
    const after = purchase("Pending", [line(10, 5)]);
    expect(() => net(stock({ quantity: 12, costPrice: 5, unavailableQuantity: 3 }), before, after)).toThrow(
      /المحجوزة/,
    );
  });

  it("rejects a reversal that would make WAC negative instead of clamping", () => {
    // stock worth 10 total (qty 10 @ 1), reversing 5 units that were bought at 10 each (value 50)
    const before = purchase("Received", [line(5, 10)]);
    const after = purchase("Pending", [line(5, 10)]);
    expect(() => net(stock({ quantity: 10, costPrice: 1 }), before, after)).toThrow(/سالبًا/);
  });

  it("keeps previous WAC and does not divide by zero when stock hits zero", () => {
    const before = purchase("Received", [line(10, 5)]);
    const after = purchase("Pending", [line(10, 5)]);
    const c = net(stock({ quantity: 10, costPrice: 5 }), before, after)!;
    expect(c.newStock).toBe(0);
    expect(c.newWac).toBe(5);
    expect(Number.isFinite(c.newWac)).toBe(true);
  });

  it("does not produce NaN when existing quantity is negative (corrupt data)", () => {
    const after = purchase("Received", [line(10, 4)]);
    const c = net(stock({ quantity: -2, costPrice: 9 }), null, after)!;
    expect(c.newStock).toBe(8);
    expect(Number.isFinite(c.newWac)).toBe(true);
    expect(c.newWac).toBeCloseTo(5); // value 40 / 8 units, negative base ignored
  });

  it("is idempotent: re-saving Received -> Received with identical lines is a no-op", () => {
    const p = purchase("Received", [line(10, 5), line(5, 7)]);
    expect(net(stock({ quantity: 15, costPrice: 5.67 }), p, p)).toBeNull();
  });

  it("nets duplicate lines of the same product", () => {
    const agg = aggregateByProduct([line(3, 10), line(2, 20)]);
    expect(agg.get("p1")).toEqual({ qty: 5, value: 70 });
  });

  it("ignores non-Received purchases and invalid lines", () => {
    expect(effectiveItems(purchase("Pending", [line(1, 1)]))).toHaveLength(0);
    expect(effectiveItems(purchase("Received", [line(0, 1), { ...line(1, 1), productId: "" }]))).toHaveLength(0);
  });
});

describe("legacy local-only receipt reversal", () => {
  const legacyNet = (s: ProductStockSnapshot, qty: number, unitCost: number) =>
    computeNetChange(
      "p1",
      s,
      aggregateByProduct(effectiveItems(purchase("Received", [line(qty, unitCost)]))).get("p1")!,
      { qty: 0, value: 0 },
      { legacy: true },
    );

  it("subtracts quantity and keeps current costPrice even when WAC math would go negative", () => {
    const c = legacyNet(stock({ quantity: 10, costPrice: 1 }), 5, 10)!;
    expect(c.newStock).toBe(5);
    expect(c.newWac).toBe(1);
  });

  it("blocks with available vs required in the message", () => {
    expect(() => legacyNet(stock({ quantity: 8, costPrice: 1, reservedQuantity: 5 }), 5, 10)).toThrow(
      /المتاح 3 أقل من الكمية المطلوب خصمها 5/,
    );
  });

  it("blocks when stock is below the quantity", () => {
    expect(() => legacyNet(stock({ quantity: 2, costPrice: 1 }), 5, 10)).toThrow(/المتاح 2 .* 5/);
  });
});
