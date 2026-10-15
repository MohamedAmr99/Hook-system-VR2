export type OrderStatus =
  | "Pending"
  | "Processing"
  | "Shipped"
  | "Delivered"
  | "Cancelled"
  | "Returned" // Retained for legacy UI filter compatibility
  | "ReturnedToSeller" // Retained for legacy UI filter compatibility
  | "ReturningToSeller" // Retained for legacy UI filter compatibility
  | "RejectedByBuyer"; // Retained for legacy UI filter compatibility

export type StockState = "reserved" | "deducted" | "released";

export type PaymentStatus =
  | "Unpaid"
  | "Paid"
  | "PartiallyRefunded"
  | "Refunded";

export type FinancialStatus =
  | "Unsettled"
  | "PendingSettlement"
  | "PartiallySettled"
  | "Settled"
  | "Disputed"
  | "Compensated"
  | "PartiallyCompensated"
  | "NotCompensated";

export type ReturnStatus =
  | "None"
  | "Requested"
  | "Returned"
  | "Damaged"
  | "LostInTransit";

export type ReturnCondition =
  | "Pending"
  | "Sellable"
  | "Damaged"
  | "MissingParts";

export interface OrderItem {
  id: string; // Internal Item ID
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number; // Selling price
  unitCogs: number; // Historical Weighted Average Cost at time of sale
  discount: number;
  tax: number; // Configurable tax
}

export interface Order {
  id: string; // Internal ID
  platformOrderId: string; // External ID
  platform: string;

  // Statuses (Separated)
  status: OrderStatus;
  stockState?: StockState; // State machine for inventory idempotency
  paymentStatus: PaymentStatus;
  financialStatus: FinancialStatus;
  returnStatus?: ReturnStatus;
  returnCondition?: ReturnCondition;
  /** Number of return documents linked to this order. Maintained by ReturnService in a transaction. */
  returnCount?: number;
  /** Denormalized flag: true when returnCount > 0. Undefined on legacy orders (backfill pending). */
  hasReturn?: boolean;

  orderDate: number; // Unix timestamp

  items: OrderItem[];

  // Financials
  subtotal: number; // Gross items
  discountTotal: number;
  taxTotal: number;
  shippingCollected: number; // Shipping charged to customer

  totalRevenue: number; // subtotal - discountTotal + taxTotal + shippingCollected
  totalCogs: number; // Sum of (items.unitCogs * quantity)
  grossProfit: number; // totalRevenue - totalCogs

  // Marketplace Fees (Not COGS)
  sellingFees: number;
  fulfillmentFees: number;
  otherFees: number;

  netPayoutExpected: number; // totalRevenue - (sellingFees + fulfillmentFees + otherFees). The expectation: never overwritten by settlement imports.

  /** Net actually paid by the marketplace, summed from all stored settlement lines for this order. */
  actualPayout?: number;
  /** When the order reached financialStatus "Settled" (null when it is not fully settled). */
  settledAt?: number | null;

  // Payment & Collection Tracking
  paidAmount?: number; // Actual amount collected
  refundedAmount?: number; // Actual amount refunded to customer
  netCollectedAmount?: number; // paidAmount - refundedAmount

  // Returns Financials
  returnShippingCost?: number;
  refundAmount?: number;
  returnClaimAmount?: number;

  // Settlement Reference
  settlementId?: string;

  // Audit
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}
