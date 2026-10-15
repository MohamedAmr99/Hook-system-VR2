import { Order, OrderStatus } from "@/features/orders/types/order.types";
import { Return } from "@/features/returns/types/return.types";

export interface OrderFinancialSummary {
  originalRevenue: number;
  originalCogs: number;
  originalFees: number;
  originalProfit: number;

  hasReturn: boolean;
  customerRefund: number;
  effectiveRevenue: number;
  netReturnYield: number;
  finalNetProfit: number;

  paidAmount: number;
  refundedAmount: number;
  netCollectedAmount: number;
}

/**
 * Calculates the specific COGS of the returned item(s) in an order.
 * Handles partial returns (calculates only returned item quantity, not total order COGS).
 */
export function calculateReturnedItemCogs(order: Order, returnDoc?: Return): number {
  if (!returnDoc || !order.items || order.items.length === 0) return 0;

  const item = returnDoc.orderItemId
    ? order.items.find((i) => i.id === returnDoc.orderItemId || i.productId === returnDoc.orderItemId)
    : order.items[0];

  if (!item) return Number(order.totalCogs || 0);

  const unitCogs = Number(item.unitCogs || 0);
  const returnedQty = Number(returnDoc.quantity || item.quantity || 1);

  return unitCogs * returnedQty;
}

/**
 * Calculates Net Return Yield (صافي عائد المرتجع)
 * Net Yield = Compensation - Customer Refund - Retained Fees - Irrecoverable COGS (if Damaged/Scrap)
 * Positive (+) means net financial gain from claim/compensation.
 * Negative (-) means net financial loss from return.
 */
export function calculateNetReturnYield(
  customerRefundAmount: number,
  compensationAmount: number,
  platformFeeRetained: number = 0,
  shippingCostRetained: number = 0,
  isDamagedOrScrap: boolean = false,
  damagedItemCogs: number = 0
): number {
  const compensation = Number(compensationAmount || 0);
  const refund = Number(customerRefundAmount || 0);
  const retainedFees = Number(platformFeeRetained || 0) + Number(shippingCostRetained || 0);
  const lostCogs = isDamagedOrScrap ? Number(damagedItemCogs || 0) : 0;

  return compensation - refund - retainedFees - lostCogs;
}

/**
 * Legacy calculation helper for return net loss (kept for backward compatibility)
 * Net Loss = Customer Refund + Retained Fees - Compensation
 */
export function calculateReturnNetLoss(
  customerRefundAmount: number,
  compensationAmount: number,
  platformFeeRetained: number = 0,
  shippingCostRetained: number = 0
): number {
  return (
    Number(customerRefundAmount || 0) +
    Number(platformFeeRetained || 0) +
    Number(shippingCostRetained || 0) -
    Number(compensationAmount || 0)
  );
}

/**
 * Single Source of Truth for complete order financials across OrderListPage, Dashboard, and Reports.
 * Separates Original Order Economics from Return Impact with ZERO double counting.
 */
export function calculateOrderFinancials(order: Order, returnDoc?: Return): OrderFinancialSummary {
  const originalRevenue = Number(order.totalRevenue || 0);
  const originalCogs = Number(order.totalCogs || 0);
  const originalFees =
    Number(order.sellingFees || 0) +
    Number(order.fulfillmentFees || 0) +
    Number(order.otherFees || 0);

  const originalProfit = originalRevenue - originalCogs - originalFees;

  const hasLegacyReturnStatus = [
    "Returned",
    "ReturnedToSeller",
    "ReturningToSeller",
    "RejectedByBuyer",
  ].includes(order.status);

  const hasReturn = Boolean(returnDoc) || hasLegacyReturnStatus;

  let customerRefund = 0;
  let netReturnYield = 0;
  let finalNetProfit = originalProfit;

  if (returnDoc) {
    customerRefund = Number(returnDoc.customerRefundAmount || 0);
    const returnedItemCogs = calculateReturnedItemCogs(order, returnDoc);
    const isHealthy = returnDoc.returnCondition === "healthy";
    const isDamaged = !isHealthy;

    // 1. Net Return Yield for the Returns Page
    netReturnYield = calculateNetReturnYield(
      returnDoc.customerRefundAmount,
      returnDoc.compensationAmount,
      returnDoc.platformFeeRetained,
      returnDoc.shippingCostRetained,
      isDamaged,
      returnedItemCogs
    );

    // 2. Final Order Profit:
    // Final Profit = Original Profit + Compensation - Customer Refund - Retained Extra Fees + (Recovered Item COGS if Healthy)
    // When healthy, the item was returned to inventory stock, so its COGS is restored.
    // When damaged, the physical item is lost/destroyed, so COGS is not recovered.
    const recoveredCogs = isHealthy ? returnedItemCogs : 0;
    const retainedExtraFees =
      Number(returnDoc.platformFeeRetained || 0) + Number(returnDoc.shippingCostRetained || 0);

    const returnImpactDelta =
      Number(returnDoc.compensationAmount || 0) -
      customerRefund -
      retainedExtraFees +
      recoveredCogs;

    finalNetProfit = originalProfit + returnImpactDelta;
  } else if (order.status === "Cancelled") {
    customerRefund = originalRevenue;
    finalNetProfit = 0 - originalFees;
  } else if (hasLegacyReturnStatus) {
    const compensation = Number(order.returnClaimAmount || 0);
    customerRefund = Number(order.refundAmount || originalRevenue);
    let lostCogs = 0;
    if (order.returnCondition && ["Damaged", "MissingParts"].includes(order.returnCondition)) {
      lostCogs = originalCogs;
    }
    finalNetProfit = compensation - originalFees - lostCogs;
    netReturnYield = compensation - customerRefund - lostCogs;
  }

  // Payments & Collections tracking (with safe fallbacks for historical data)
  let paidAmount = 0;
  if (order.paidAmount !== undefined && order.paidAmount !== null) {
    paidAmount = Number(order.paidAmount);
  } else {
    paidAmount =
      order.paymentStatus === "Paid" ||
      order.paymentStatus === "Refunded" ||
      order.paymentStatus === "PartiallyRefunded"
        ? originalRevenue
        : 0;
  }

  let refundedAmount = 0;
  if (order.refundedAmount !== undefined && order.refundedAmount !== null) {
    refundedAmount = Number(order.refundedAmount);
  } else if (returnDoc) {
    refundedAmount = customerRefund;
  } else if (order.paymentStatus === "Refunded") {
    refundedAmount = paidAmount > 0 ? paidAmount : originalRevenue;
  } else if (order.paymentStatus === "PartiallyRefunded") {
    refundedAmount = Number(order.refundAmount || 0);
  }

  const netCollectedAmount = paidAmount - refundedAmount;

  // Effective Sales (Realized based on payment & collection):
  let effectiveRevenue = 0;
  if (order.paymentStatus === "Unpaid" || paidAmount === 0) {
    effectiveRevenue = 0;
  } else if (order.paymentStatus === "Refunded") {
    effectiveRevenue = 0;
  } else if (order.paymentStatus === "PartiallyRefunded" || paidAmount < originalRevenue) {
    effectiveRevenue = Math.max(0, netCollectedAmount);
  } else {
    // Normal Paid
    effectiveRevenue = Math.max(0, originalRevenue - customerRefund);
  }

  // Final Net Profit adjustment when Unpaid:
  if (order.paymentStatus === "Unpaid" || paidAmount === 0) {
    finalNetProfit = 0;
  } else if (order.paymentStatus === "Refunded" && !hasReturn) {
    finalNetProfit = 0 - originalFees;
  }

  return {
    originalRevenue,
    originalCogs,
    originalFees,
    originalProfit,
    hasReturn,
    customerRefund,
    effectiveRevenue,
    netReturnYield,
    finalNetProfit,
    paidAmount,
    refundedAmount,
    netCollectedAmount,
  };
}

/**
 * Single Source of Truth for Order Net Profit calculation
 */
export function calculateOrderNetProfit(order: Order, returnDoc?: Return): number {
  return calculateOrderFinancials(order, returnDoc).finalNetProfit;
}

/**
 * State machine for allowed order status transitions
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  Pending: ["Processing", "Cancelled"],
  Processing: ["Shipped", "Cancelled"],
  Shipped: ["Delivered"],
  Delivered: [],
  Cancelled: [],
  Returned: [],
  ReturnedToSeller: [],
  ReturningToSeller: [],
  RejectedByBuyer: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const LEGACY_RETURN_STATUSES: readonly OrderStatus[] = [
  "Returned",
  "ReturnedToSeller",
  "ReturningToSeller",
  "RejectedByBuyer",
];

/** Arabic message shown when a status change is rejected because the order has a return. */
export const ORDER_HAS_RETURN_STATUS_ERROR = "لا يمكن تغيير حالة طلب له مرتجع";

/**
 * True when the order has (or had) a return. Single predicate used by the orders list badge,
 * the status cell and the order form.
 * Sources: the denormalized `hasReturn`/`returnCount`, a real return document for the order
 * (fabricated `ret-` placeholders built from legacy order fields are ignored), or legacy
 * return statuses / `returnStatus`.
 */
export function orderHasReturn(
  order: Pick<Order, "id" | "status" | "hasReturn" | "returnCount" | "returnStatus">,
  returns: ReadonlyArray<Pick<Return, "id" | "orderId">> = [],
): boolean {
  if (order.hasReturn === true) return true;
  if (typeof order.returnCount === "number" && order.returnCount > 0) return true;
  if (returns.some((r) => r.orderId === order.id && !r.id.startsWith("ret-"))) return true;
  if (LEGACY_RETURN_STATUSES.includes(order.status)) return true;
  return Boolean(order.returnStatus && order.returnStatus !== "None");
}

/**
 * Pure validator for status changes. Returns an Arabic error message when the change must be
 * rejected, or null when it is allowed. Editing other fields with an unchanged status is allowed.
 */
export function validateOrderStatusChange(params: {
  currentStatus: OrderStatus;
  nextStatus: OrderStatus;
  hasReturn: boolean;
}): string | null {
  if (params.currentStatus === params.nextStatus) return null;
  return params.hasReturn ? ORDER_HAS_RETURN_STATUS_ERROR : null;
}
