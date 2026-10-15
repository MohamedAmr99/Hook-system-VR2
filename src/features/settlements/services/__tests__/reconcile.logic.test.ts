import { describe, it, expect } from "vitest";
import fixture from "../../__fixtures__/amazon-statement.anonymized.csv?raw";
import { parseAmazonStatementCsv } from "../../parsers/amazonStatementCsv.parser";
import { buildOrderSettlementUpdates, reconcileSettlement, sumLineTotals } from "../reconcile.logic";
import type { Order } from "@/features/orders/types/order.types";
import type { Return } from "@/features/returns/types/return.types";
import type { ReconciliationReport, ReconciliationResult, SettlementLine } from "../../types/settlement.types";

const lines = parseAmazonStatementCsv(fixture, { importedBy: "u", importedAt: 1 }).lines;
const PERIOD_FROM = new Date(2026, 8, 18).getTime();
const PERIOD_TO = new Date(2026, 9, 2).getTime();

const ID1 = "402-0000000-0000001"; // sale 480.5 + Easy Ship -60
const ID2 = "402-0000000-0000002"; // sale 948 + refund -960 + SAFE-T 700
const ID3 = "402-0000000-0000003"; // cancellation fee -25.5
const ID4 = "402-0000000-0000004"; // two identical sales 299 + 299
const ID5 = "402-0000000-0000005"; // refund -221 only
const ID6 = "402-0000000-0000006"; // Easy Ship -53.9 only

function makeOrder(overrides: Partial<Order> & Pick<Order, "id" | "platformOrderId">): Order {
  return {
    platform: "Amazon",
    status: "Delivered",
    paymentStatus: "Paid",
    financialStatus: "Unsettled",
    orderDate: new Date(2026, 8, 17).getTime(),
    items: [],
    subtotal: 0,
    discountTotal: 0,
    taxTotal: 0,
    shippingCollected: 0,
    totalRevenue: 0,
    totalCogs: 0,
    grossProfit: 0,
    sellingFees: 0,
    fulfillmentFees: 0,
    otherFees: 0,
    netPayoutExpected: 0,
    createdAt: 0,
    updatedAt: 0,
    createdBy: "u",
    updatedBy: "u",
    ...overrides,
  };
}

function makeReturn(overrides: Partial<Return> & Pick<Return, "id" | "orderId">): Return {
  return {
    returnCondition: "healthy",
    returnStage: "inspected",
    compensationAmount: 0,
    customerRefundAmount: 0,
    restocked: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Order 1 recorded exactly as Amazon paid it: 500 + 26 shipping, 45.5 referral, 60 Easy Ship. */
const exactOrder1 = makeOrder({
  id: "o1", platformOrderId: ID1, totalRevenue: 526, shippingCollected: 26, sellingFees: 45.5, fulfillmentFees: 60,
});
/** Order 2: 1000 + 38 shipping, referral 90; fully refunded, Amazon kept 12, SAFE-T paid 700. */
const order2 = makeOrder({ id: "o2", platformOrderId: ID2, totalRevenue: 1038, shippingCollected: 38, sellingFees: 90 });
const return2 = makeReturn({
  id: "r2", orderId: "o2", customerRefundAmount: 1038, platformFeeRetained: 12, compensationAmount: 700,
});

function only(id: string): SettlementLine[] {
  return lines.filter((l) => l.platformOrderId === id);
}
function run(lineSet: SettlementLine[], orders: Order[], returns: Return[] = []): ReconciliationReport {
  return reconcileSettlement({ lines: lineSet, orders, returns });
}
function result(report: ReconciliationReport, id: string): ReconciliationResult {
  const r = report.results.find((x) => x.platformOrderId === id);
  if (!r) throw new Error(`no result for ${id}`);
  return r;
}
function causeMap(r: ReconciliationResult): Record<string, number> {
  return Object.fromEntries(r.causes.map((c) => [c.cause, c.amount]));
}
const sumCauses = (r: ReconciliationResult) => Math.round(r.causes.reduce((s, c) => s + c.amount, 0) * 100) / 100;

describe("reconcileSettlement — per cause", () => {
  it("exact match -> Settled with no causes", () => {
    const r = result(run(only(ID1), [exactOrder1]), ID1);
    expect(r).toMatchObject({ expected: 420.5, actual: 420.5, diff: 0, financialStatus: "Settled", causes: [] });
  });

  it("price_mismatch", () => {
    const r = result(run(only(ID1), [{ ...exactOrder1, totalRevenue: 550 }]), ID1);
    expect(causeMap(r)).toEqual({ price_mismatch: -24 });
    expect(r.financialStatus).toBe("Disputed");
  });

  it("fee_mismatch", () => {
    const r = result(run(only(ID1), [{ ...exactOrder1, sellingFees: 40 }]), ID1);
    expect(causeMap(r)).toEqual({ fee_mismatch: -5.5 });
  });

  it("shipping_credit (shipping not recorded on the order)", () => {
    const r = result(run(only(ID1), [{ ...exactOrder1, totalRevenue: 500, shippingCollected: 0 }]), ID1);
    expect(causeMap(r)).toEqual({ shipping_credit: 26 });
  });

  it("easy_ship_fee (fee not recorded on the order)", () => {
    const r = result(run(only(ID1), [{ ...exactOrder1, fulfillmentFees: 0 }]), ID1);
    expect(causeMap(r)).toEqual({ easy_ship_fee: -60 });
  });

  it("cancellation_fee", () => {
    const r = result(run(only(ID3), [makeOrder({ id: "o3", platformOrderId: ID3, status: "Cancelled", totalRevenue: 400 })]), ID3);
    expect(r).toMatchObject({ expected: 0, actual: -25.5, financialStatus: "Disputed" });
    expect(causeMap(r)).toEqual({ cancellation_fee: -25.5 });
  });

  it("sale + refund + SAFE-T on the same order aggregate to one Settled result", () => {
    const report = run(only(ID2), [order2], [return2]);
    expect(report.results).toHaveLength(1);
    // expected: 1000 - 90 + 38 - 1038 + (90 - 12) + 700 = 688 ; actual: 948 - 960 + 700 = 688
    expect(result(report, ID2)).toMatchObject({ expected: 688, actual: 688, diff: 0, financialStatus: "Settled" });
  });

  it("refund_without_return", () => {
    const r = result(run(only(ID2), [order2], []), ID2);
    expect(causeMap(r)).toEqual({ refund_without_return: -960, safet_claim: 700 });
  });

  it("refund_fee_retained (admin fee kept by Amazon not recorded)", () => {
    const r = result(run(only(ID2), [order2], [{ ...return2, platformFeeRetained: 0 }]), ID2);
    expect(causeMap(r)).toEqual({ refund_fee_retained: -12 });
  });

  it("refund_mismatch (refund amount differs from the return doc)", () => {
    const r = result(run(only(ID2), [order2], [{ ...return2, customerRefundAmount: 1000 }]), ID2);
    expect(causeMap(r).refund_mismatch).toBe(-38);
    expect(sumCauses(r)).toBe(r.diff);
  });

  it("safet_claim: received but not recorded", () => {
    const r = result(run(only(ID2), [order2], [{ ...return2, compensationAmount: 0 }]), ID2);
    expect(causeMap(r)).toEqual({ safet_claim: 700 });
  });

  it("safet_claim: recorded but not paid", () => {
    const r = result(run(only(ID2).filter((l) => l.kind !== "safet_claim"), [order2], [return2]), ID2);
    expect(causeMap(r)).toEqual({ safet_claim: -700 });
  });

  it("legacy returnClaimAmount counts as recorded compensation", () => {
    const legacy = { ...order2, status: "Returned" as const, refundAmount: 1038, returnClaimAmount: 700 };
    const r = result(run(only(ID2), [legacy], []), ID2);
    // No return doc -> no retained fee recorded -> the 12 EGP admin fee is the only gap.
    expect(causeMap(r)).toEqual({ refund_fee_retained: -12 });
  });

  it("placeholder return docs (ret-*) are ignored", () => {
    const r = result(run(only(ID2), [order2], [{ ...return2, id: "ret-o2" }]), ID2);
    expect(causeMap(r).refund_without_return).toBe(-960);
  });

  it("missing_in_system", () => {
    const r = result(run(only(ID6), []), ID6);
    expect(r).toMatchObject({ match: "missing_in_system", expected: 0, actual: -53.9, financialStatus: null });
    expect(causeMap(r)).toEqual({ missing_in_system: -53.9 });
  });

  it("not_in_sheet_yet: only the Easy Ship fee arrived, sale pending -> PartiallySettled", () => {
    const o6 = makeOrder({ id: "o6", platformOrderId: ID6, totalRevenue: 300, sellingFees: 27, fulfillmentFees: 53.9 });
    const r = result(run(only(ID6), [o6]), ID6);
    expect(causeMap(r)).toEqual({ not_in_sheet_yet: -273 });
    expect(r.financialStatus).toBe("PartiallySettled");
  });

  it("not_in_sheet_yet: payable order in the window with no lines at all", () => {
    const o7 = makeOrder({ id: "o7", platformOrderId: "402-0000000-0000007", totalRevenue: 200, sellingFees: 20 });
    const old = makeOrder({ id: "o8", platformOrderId: "402-0000000-0000008", totalRevenue: 50, orderDate: PERIOD_FROM - 90 * 864e5 });
    const pending = makeOrder({ id: "o9", platformOrderId: "402-0000000-0000009", totalRevenue: 50, status: "Pending" });
    const settled = makeOrder({ id: "o10", platformOrderId: "402-0000000-0000010", totalRevenue: 50, financialStatus: "Settled" });
    const report = reconcileSettlement({
      lines: [], orders: [o7, old, pending, settled], returns: [],
      notInSheetWindow: { from: PERIOD_FROM, to: PERIOD_TO },
    });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ match: "not_in_sheet", expected: 180, actual: 0, financialStatus: null });
    expect(causeMap(report.results[0])).toEqual({ not_in_sheet_yet: -180 });
  });

  it("platform-level advertising is a separate bucket, never on an order", () => {
    const report = run(lines.filter((l) => l.kind === "advertising"), []);
    expect(report.results).toHaveLength(0);
    expect(report.platformLines).toHaveLength(1);
    expect(report.byCause).toEqual({ platform_level: -1500 });
    expect(report.totals).toMatchObject({ actual: -1500, expected: 0, diff: -1500, platformLevel: -1500 });
  });
});

describe("reconcileSettlement — whole fixture invariants", () => {
  const orders = [
    exactOrder1,
    order2,
    makeOrder({ id: "o3", platformOrderId: ID3, status: "Cancelled" }),
    makeOrder({ id: "o4", platformOrderId: ID4, totalRevenue: 652, shippingCollected: 52, sellingFees: 54 }),
    makeOrder({ id: "o5", platformOrderId: ID5, totalRevenue: 226, shippingCollected: 26, sellingFees: 18 }),
  ];
  const report = reconcileSettlement({
    lines, orders, returns: [return2], notInSheetWindow: { from: PERIOD_FROM, to: PERIOD_TO },
  });

  it("actual total equals the sum of the الإجمالي column", () => {
    expect(report.totals.actual).toBe(sumLineTotals(lines));
    expect(report.totals.actual).toBe(-93.9);
  });

  it("every result's causes sum to its diff, and byCause sums to the total diff", () => {
    for (const r of report.results) expect(sumCauses(r)).toBe(r.diff);
    const byCauseSum = Object.values(report.byCause).reduce((s, v) => s + (v ?? 0), 0);
    expect(Math.round(byCauseSum * 100) / 100).toBe(report.totals.diff);
    expect(report.totals.diff).toBe(Math.round((report.totals.actual - report.totals.expected) * 100) / 100);
  });

  it("two identical sale rows both count (no accidental dedupe)", () => {
    expect(result(report, ID4)).toMatchObject({ actual: 598, expected: 598, financialStatus: "Settled" });
  });
});

describe("buildOrderSettlementUpdates", () => {
  it("writes only settlement fields; never netPayoutExpected; payout on first order only", () => {
    const twin = makeOrder({ id: "o1b", platformOrderId: ID1 });
    const report = run(only(ID1), [exactOrder1, twin]);
    const updates = buildOrderSettlementUpdates(report, "2026-09-18_2026-10-02", 123);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      orderId: "o1", financialStatus: "Settled", actualPayout: 420.5, settledAt: 123, settlementId: "2026-09-18_2026-10-02",
    });
    expect(updates[1].actualPayout).toBe(0);
    for (const u of updates) expect(Object.keys(u)).not.toContain("netPayoutExpected");
  });

  it("skips missing-in-system and not-in-sheet results, Disputed has no settledAt", () => {
    const report = run(only(ID1).concat(only(ID6)), [{ ...exactOrder1, fulfillmentFees: 0 }]);
    const updates = buildOrderSettlementUpdates(report, "p", 5);
    expect(updates).toEqual([{ orderId: "o1", financialStatus: "Disputed", actualPayout: 420.5, settledAt: null, settlementId: "p" }]);
  });
});
