import { z } from "zod";

/** Legacy record shape produced by the English TSV flat-file parser (AmazonParserService). */
export const SettlementRecordSchema = z.object({
  id: z.string(), // e.g. platformOrderId or composite key
  date: z.number(), // Extracted from 'date/time'
  settlementId: z.string(),
  type: z.string(), // Order, Refund, Service Fee, etc.
  platformOrderId: z.string(),
  sku: z.string().optional(),
  description: z.string().optional(),
  quantity: z.number().default(0),
  marketplace: z.string().optional(),
  fulfillment: z.string().optional(),
  productSales: z.number().default(0),
  shippingCredits: z.number().default(0),
  promotionalRebates: z.number().default(0),
  sellingFees: z.number().default(0),
  fbaFees: z.number().default(0),
  otherTransactionFees: z.number().default(0),
  other: z.number().default(0),
  total: z.number().default(0),
  transactionStatus: z.string().optional(),
  createdAt: z.number(),
  createdBy: z.string()
});

/** Classification of one statement row. */
export const SettlementLineKindSchema = z.enum([
  "sale",
  "refund",
  "easy_ship_fee",
  "cancellation_fee",
  "advertising",
  "safet_claim",
  "other",
]);

/**
 * One row of a marketplace statement, normalized. Stored in `settlementLines` under a
 * deterministic id so re-importing the same (or an overlapping) file never duplicates money.
 * Firestore rejects `undefined`, so optional values are `null`.
 */
export const SettlementLineSchema = z.object({
  id: z.string().min(1),
  platform: z.literal("Amazon"),
  source: z.literal("amazon_statement_csv"),
  kind: SettlementLineKindSchema,
  /** Value of the "نوع المعاملة" column as found in the file. */
  rawType: z.string(),
  /** Local midnight of the transaction date (ms). */
  date: z.number(),
  /** yyyy-MM-dd, timezone independent; used in the deterministic id. */
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** null for platform-level rows (order id "---"), e.g. advertising. */
  platformOrderId: z.string().nullable(),
  description: z.string(),
  safetClaimId: z.string().nullable(),
  /** "إجمالي رسوم المنتج" (item price; negative on refunds). */
  productCharges: z.number(),
  /** "إجمالي التخفيضات". */
  promotions: z.number(),
  /** "رسوم أمازون" (referral/closing fees; negative on sales, positive refund on refunds). */
  platformFees: z.number(),
  /** "أخرى" (shipping credit on sale/refund rows, claim amount on SAFE-T rows). */
  other: z.number(),
  /** "الإجمالي" — the authoritative net amount of the row. */
  total: z.number(),
  /** 1-based data row number in the source file (header excluded). */
  rowNumber: z.number().int(),
  /** Statement period key "yyyy-MM-dd_yyyy-MM-dd" (informational, not part of the id). */
  statementId: z.string(),
  importedAt: z.number(),
  importedBy: z.string(),
});

export const ReconciliationCauseSchema = z.enum([
  "missing_in_system",
  "not_in_sheet_yet",
  "price_mismatch",
  "fee_mismatch",
  "shipping_credit",
  "easy_ship_fee",
  "cancellation_fee",
  "refund_without_return",
  "refund_mismatch",
  "refund_fee_retained",
  "safet_claim",
  "other",
  "platform_level",
]);
