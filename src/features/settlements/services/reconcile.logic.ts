import type { Order, OrderStatus } from "@/features/orders/types/order.types";
import type { Return } from "@/features/returns/types/return.types";
import { calculateOrderFinancials } from "@/shared/utils/orderCalculations";
import { isPlaceholderReturnId } from "@/features/returns/services/return.logic";
import type {
  CauseAmount,
  OrderSettlementUpdate,
  ReconciliationCause,
  ReconciliationReport,
  ReconciliationResult,
  SettlementLine,
} from "../types/settlement.types";

/**
 * Pure settlement reconciliation: groups statement lines by marketplace order id and compares
 * what was actually paid with what the system expects (derived from calculateOrderFinancials).
 *
 * All arithmetic is done in integer cents so `diff === sum(causes)` holds exactly and
 * `totals.actual === sum of the "الإجمالي" column`.
 *
 * Expected payout per order (component -> sheet columns it is compared with):
 *   product        = totalRevenue - shippingCollected  -> sale rows: productCharges + promotions
 *   fees           = -(sellingFees + otherFees)        -> sale rows: platformFees
 *   shipping       = shippingCollected                 -> sale rows: other (+ rounding residual)
 *   fulfillment    = -fulfillmentFees                  -> Easy Ship fee rows
 *   refundCustomer = -customerRefund                   -> refund rows: productCharges + promotions + other
 *   refundFees     = fees refunded pro rata - platformFeeRetained - shippingCostRetained
 *                                                     -> refund rows: platformFees
 *   compensation   = Return.compensationAmount (or legacy order.returnClaimAmount) -> SAFE-T rows
 * Cancelled orders expect 0 on every component.
 */

type Cents = number;
const toCents = (v: number | null | undefined): Cents => Math.round(Number(v || 0) * 100);
const fromCents = (c: Cents): number => c / 100;

export const PAYABLE_STATUSES: readonly OrderStatus[] = [
  "Shipped",
  "Delivered",
  "Returned",
  "ReturnedToSeller",
  "ReturningToSeller",
  "RejectedByBuyer",
];

interface ActualBuckets {
  saleProduct: Cents;
  saleFees: Cents;
  saleShipping: Cents;
  easyShip: Cents;
  cancellation: Cents;
  refundCustomer: Cents;
  refundFees: Cents;
  safet: Cents;
  other: Cents;
  hasSale: boolean;
  hasRefund: boolean;
  hasEasyShip: boolean;
}

interface ExpectedBuckets {
  product: Cents;
  fees: Cents;
  shipping: Cents;
  fulfillment: Cents;
  refundCustomer: Cents;
  refundFees: Cents;
  compensation: Cents;
  hasReturn: boolean;
}

function emptyActual(): ActualBuckets {
  return {
    saleProduct: 0, saleFees: 0, saleShipping: 0, easyShip: 0, cancellation: 0,
    refundCustomer: 0, refundFees: 0, safet: 0, other: 0,
    hasSale: false, hasRefund: false, hasEasyShip: false,
  };
}

function bucketLines(lines: readonly SettlementLine[]): ActualBuckets {
  const a = emptyActual();
  for (const l of lines) {
    const total = toCents(l.total);
    switch (l.kind) {
      case "sale": {
        const product = toCents(l.productCharges) + toCents(l.promotions);
        const fees = toCents(l.platformFees);
        a.saleProduct += product;
        a.saleFees += fees;
        // Residual keeps the bucket sum equal to the authoritative total.
        a.saleShipping += total - product - fees;
        a.hasSale = true;
        break;
      }
      case "refund": {
        const fees = toCents(l.platformFees);
        a.refundFees += fees;
        a.refundCustomer += total - fees;
        a.hasRefund = true;
        break;
      }
      case "easy_ship_fee":
        a.easyShip += total;
        a.hasEasyShip = true;
        break;
      case "cancellation_fee":
        a.cancellation += total;
        break;
      case "safet_claim":
        a.safet += total;
        break;
      case "advertising":
      case "other":
        a.other += total;
        break;
    }
  }
  return a;
}

/** Expected payout components of one order, from the same helper the dashboards use. */
export function expectedBucketsForOrder(order: Order, orderReturns: readonly Return[]): ExpectedBuckets {
  const realReturns = orderReturns.filter((r) => !isPlaceholderReturnId(r.id));
  const fin = calculateOrderFinancials(order, realReturns[0]);

  if (order.status === "Cancelled") {
    return {
      product: 0, fees: 0, shipping: 0, fulfillment: 0,
      refundCustomer: 0, refundFees: 0, compensation: 0, hasReturn: false,
    };
  }

  const revenue = toCents(fin.originalRevenue);
  const shipping = toCents(order.shippingCollected);
  const fees = -(toCents(order.sellingFees) + toCents(order.otherFees));
  const fulfillment = -toCents(order.fulfillmentFees);
  const hasReturn = fin.hasReturn || realReturns.length > 0;

  let customerRefund: Cents = 0;
  let compensation: Cents = 0;
  let retained: Cents = 0;
  if (hasReturn) {
    if (realReturns.length > 1) {
      customerRefund = realReturns.reduce((s, r) => s + toCents(r.customerRefundAmount), 0);
    } else {
      customerRefund = toCents(fin.customerRefund);
    }
    if (realReturns.length > 0) {
      compensation = realReturns.reduce((s, r) => s + toCents(r.compensationAmount), 0);
      retained = realReturns.reduce(
        (s, r) => s + toCents(r.platformFeeRetained) + toCents(r.shippingCostRetained),
        0,
      );
    } else {
      compensation = toCents(order.returnClaimAmount);
    }
  }

  const refundShare = revenue > 0 ? Math.min(1, customerRefund / revenue) : 0;
  const refundFees = customerRefund > 0 ? Math.round(-fees * refundShare) - retained : 0;

  return {
    product: revenue - shipping,
    fees,
    shipping,
    fulfillment,
    refundCustomer: -customerRefund,
    refundFees,
    compensation,
    hasReturn,
  };
}

function sumExpected(list: readonly ExpectedBuckets[]): ExpectedBuckets {
  return list.reduce<ExpectedBuckets>(
    (acc, e) => ({
      product: acc.product + e.product,
      fees: acc.fees + e.fees,
      shipping: acc.shipping + e.shipping,
      fulfillment: acc.fulfillment + e.fulfillment,
      refundCustomer: acc.refundCustomer + e.refundCustomer,
      refundFees: acc.refundFees + e.refundFees,
      compensation: acc.compensation + e.compensation,
      hasReturn: acc.hasReturn || e.hasReturn,
    }),
    { product: 0, fees: 0, shipping: 0, fulfillment: 0, refundCustomer: 0, refundFees: 0, compensation: 0, hasReturn: false },
  );
}

function expectedTotal(e: ExpectedBuckets): Cents {
  return e.product + e.fees + e.shipping + e.fulfillment + e.refundCustomer + e.refundFees + e.compensation;
}

function actualTotal(a: ActualBuckets): Cents {
  return a.saleProduct + a.saleFees + a.saleShipping + a.easyShip + a.cancellation +
    a.refundCustomer + a.refundFees + a.safet + a.other;
}

/** Cause attribution. Invariant: sum of returned cents === actualTotal(a) - expectedTotal(e). */
function attributeCauses(a: ActualBuckets, e: ExpectedBuckets): Map<ReconciliationCause, Cents> {
  const causes = new Map<ReconciliationCause, Cents>();
  const add = (cause: ReconciliationCause, cents: Cents) => {
    causes.set(cause, (causes.get(cause) ?? 0) + cents);
  };
  let pending: Cents = 0;

  if (a.hasSale) {
    add("price_mismatch", a.saleProduct - e.product);
    add("fee_mismatch", a.saleFees - e.fees);
    add("shipping_credit", a.saleShipping - e.shipping);
  } else {
    pending += e.product + e.fees + e.shipping;
  }

  if (a.hasEasyShip) add("easy_ship_fee", a.easyShip - e.fulfillment);
  else pending += e.fulfillment;

  add("cancellation_fee", a.cancellation);

  if (!e.hasReturn) {
    add("refund_without_return", a.refundCustomer + a.refundFees);
  } else if (a.hasRefund) {
    add("refund_mismatch", a.refundCustomer - e.refundCustomer);
    add("refund_fee_retained", a.refundFees - e.refundFees);
  } else {
    pending += e.refundCustomer + e.refundFees;
  }

  add("safet_claim", a.safet - e.compensation);
  add("other", a.other);
  add("not_in_sheet_yet", -pending);

  for (const [k, v] of causes) if (v === 0) causes.delete(k);
  return causes;
}

function toCauseList(causes: Map<ReconciliationCause, Cents>): CauseAmount[] {
  return [...causes.entries()].map(([cause, cents]) => ({ cause, amount: fromCents(cents) }));
}

function statusFor(causes: Map<ReconciliationCause, Cents>): ReconciliationResult["financialStatus"] {
  if (causes.size === 0) return "Settled";
  if (causes.size === 1 && causes.has("not_in_sheet_yet")) return "PartiallySettled";
  return "Disputed";
}

export interface ReconcileInput {
  lines: readonly SettlementLine[];
  orders: readonly Order[];
  returns: readonly Return[];
  /** Platform name used to list system orders that are absent from the sheet. Default "Amazon". */
  platform?: string;
  /**
   * Window for "in system but not in sheet": payable orders of `platform` with orderDate in
   * [from - lookbackDays, to] that are not already Settled/Compensated. Omit to skip that check.
   */
  notInSheetWindow?: { from: number; to: number; lookbackDays?: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function reconcileSettlement(input: ReconcileInput): ReconciliationReport {
  const platform = (input.platform ?? "Amazon").toLowerCase();

  const ordersByPlatformId = new Map<string, Order[]>();
  for (const o of input.orders) {
    if (!o.platformOrderId) continue;
    const key = o.platformOrderId.trim();
    const list = ordersByPlatformId.get(key) ?? [];
    list.push(o);
    ordersByPlatformId.set(key, list);
  }
  const returnsByOrderId = new Map<string, Return[]>();
  for (const r of input.returns) {
    const list = returnsByOrderId.get(r.orderId) ?? [];
    list.push(r);
    returnsByOrderId.set(r.orderId, list);
  }

  const linesByOrder = new Map<string, SettlementLine[]>();
  const platformLines: SettlementLine[] = [];
  for (const l of input.lines) {
    if (!l.platformOrderId) {
      platformLines.push(l);
      continue;
    }
    const key = l.platformOrderId.trim();
    const list = linesByOrder.get(key) ?? [];
    list.push(l);
    linesByOrder.set(key, list);
  }

  const results: ReconciliationResult[] = [];
  const byCauseCents = new Map<ReconciliationCause, Cents>();
  const addToTotals = (causes: Map<ReconciliationCause, Cents>) => {
    for (const [k, v] of causes) byCauseCents.set(k, (byCauseCents.get(k) ?? 0) + v);
  };
  let expectedSum: Cents = 0;
  let actualSum: Cents = 0;

  for (const [platformOrderId, lines] of linesByOrder) {
    const a = bucketLines(lines);
    const actual = actualTotal(a);
    const lineIds = lines.map((l) => l.id);
    const matchedOrders = [...(ordersByPlatformId.get(platformOrderId) ?? [])].sort((x, y) =>
      x.id.localeCompare(y.id),
    );

    if (matchedOrders.length === 0) {
      const causes = new Map<ReconciliationCause, Cents>([["missing_in_system", actual]]);
      if (actual === 0) causes.clear();
      addToTotals(causes);
      actualSum += actual;
      results.push({
        platformOrderId,
        orderIds: [],
        match: "missing_in_system",
        expected: 0,
        actual: fromCents(actual),
        diff: fromCents(actual),
        causes: toCauseList(causes),
        financialStatus: null,
        lineIds,
      });
      continue;
    }

    const e = sumExpected(
      matchedOrders.map((o) => expectedBucketsForOrder(o, returnsByOrderId.get(o.id) ?? [])),
    );
    const expected = expectedTotal(e);
    const causes = attributeCauses(a, e);
    addToTotals(causes);
    expectedSum += expected;
    actualSum += actual;
    results.push({
      platformOrderId,
      orderIds: matchedOrders.map((o) => o.id),
      match: "matched",
      expected: fromCents(expected),
      actual: fromCents(actual),
      diff: fromCents(actual - expected),
      causes: toCauseList(causes),
      financialStatus: statusFor(causes),
      lineIds,
    });
  }

  if (input.notInSheetWindow) {
    const { from, to, lookbackDays = 30 } = input.notInSheetWindow;
    const windowStart = from - lookbackDays * DAY_MS;
    const windowEnd = to + DAY_MS - 1;
    for (const [platformOrderId, orders] of ordersByPlatformId) {
      if (linesByOrder.has(platformOrderId)) continue;
      const eligible = orders.filter(
        (o) =>
          (o.platform ?? "").toLowerCase() === platform &&
          PAYABLE_STATUSES.includes(o.status) &&
          o.financialStatus !== "Settled" &&
          o.financialStatus !== "Compensated" &&
          o.orderDate >= windowStart &&
          o.orderDate <= windowEnd,
      );
      if (eligible.length === 0) continue;
      const e = sumExpected(eligible.map((o) => expectedBucketsForOrder(o, returnsByOrderId.get(o.id) ?? [])));
      const expected = expectedTotal(e);
      const causes = new Map<ReconciliationCause, Cents>();
      if (expected !== 0) causes.set("not_in_sheet_yet", -expected);
      addToTotals(causes);
      expectedSum += expected;
      results.push({
        platformOrderId,
        orderIds: eligible.map((o) => o.id).sort(),
        match: "not_in_sheet",
        expected: fromCents(expected),
        actual: 0,
        diff: fromCents(-expected),
        causes: toCauseList(causes),
        financialStatus: null,
        lineIds: [],
      });
    }
  }

  const platformLevel = platformLines.reduce((s, l) => s + toCents(l.total), 0);
  if (platformLevel !== 0) byCauseCents.set("platform_level", (byCauseCents.get("platform_level") ?? 0) + platformLevel);
  actualSum += platformLevel;

  const byCause: ReconciliationReport["byCause"] = {};
  for (const [k, v] of byCauseCents) if (v !== 0) byCause[k] = fromCents(v);

  return {
    results,
    platformLines,
    totals: {
      expected: fromCents(expectedSum),
      actual: fromCents(actualSum),
      diff: fromCents(actualSum - expectedSum),
      platformLevel: fromCents(platformLevel),
    },
    byCause,
  };
}

/**
 * Order writes derived from a report. Only matched orders are touched; when several internal
 * orders share one marketplace id the payout is put on the first (sorted) one so dashboards never
 * double count. Never includes stock fields or netPayoutExpected.
 */
export function buildOrderSettlementUpdates(
  report: ReconciliationReport,
  settlementId: string,
  now: number,
): OrderSettlementUpdate[] {
  const updates: OrderSettlementUpdate[] = [];
  for (const r of report.results) {
    if (r.match !== "matched" || !r.financialStatus) continue;
    r.orderIds.forEach((orderId, i) => {
      updates.push({
        orderId,
        financialStatus: r.financialStatus as OrderSettlementUpdate["financialStatus"],
        actualPayout: i === 0 ? r.actual : 0,
        settledAt: r.financialStatus === "Settled" ? now : null,
        settlementId,
      });
    });
  }
  return updates;
}

/** Sum of the "الإجمالي" column of the given lines, exact to the cent. */
export function sumLineTotals(lines: readonly SettlementLine[]): number {
  return fromCents(lines.reduce((s, l) => s + toCents(l.total), 0));
}
