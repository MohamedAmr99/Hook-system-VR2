import { z } from "zod";
import {
  ReconciliationCauseSchema,
  SettlementLineKindSchema,
  SettlementLineSchema,
  SettlementRecordSchema,
} from "../schemas/settlement.schema";
import type { FinancialStatus } from "@/features/orders/types/order.types";

export type SettlementRecord = z.infer<typeof SettlementRecordSchema>;
export type SettlementLine = z.infer<typeof SettlementLineSchema>;
export type SettlementLineKind = z.infer<typeof SettlementLineKindSchema>;
export type ReconciliationCause = z.infer<typeof ReconciliationCauseSchema>;

export interface StatementPeriod {
  /** Local midnight (ms) of the first transaction date. */
  from: number;
  /** Local midnight (ms) of the last transaction date. */
  to: number;
  /** "yyyy-MM-dd_yyyy-MM-dd" */
  key: string;
}

export interface ParseIssue {
  /** 1-based data row number (0 = header / whole file). */
  row: number;
  message: string;
}

export interface StatementParseResult {
  lines: SettlementLine[];
  /** Rows that were skipped (not imported). */
  errors: ParseIssue[];
  /** Rows imported with a caveat (e.g. components do not add up to the total). */
  warnings: ParseIssue[];
  period: StatementPeriod | null;
}

export interface CauseAmount {
  cause: ReconciliationCause;
  /** Signed: positive = received more than expected. */
  amount: number;
}

/** Match outcome of one marketplace order id. */
export type ReconciliationMatch = "matched" | "missing_in_system" | "not_in_sheet";

/** Expected vs actual for one marketplace order id (all money in EGP, 2 decimals). */
export interface ReconciliationResult {
  platformOrderId: string;
  /** Internal order ids sharing this platformOrderId (empty when missing in system). */
  orderIds: string[];
  match: ReconciliationMatch;
  expected: number;
  actual: number;
  /** actual - expected; always equals the sum of `causes[].amount`. */
  diff: number;
  causes: CauseAmount[];
  /** Status to write on the order(s); null = do not touch. */
  financialStatus: Extract<FinancialStatus, "Settled" | "PartiallySettled" | "Disputed"> | null;
  lineIds: string[];
}

export interface ReconciliationTotals {
  expected: number;
  actual: number;
  diff: number;
  /** Sum of platform-level lines (e.g. advertising), included in `actual`. */
  platformLevel: number;
}

export interface ReconciliationReport {
  results: ReconciliationResult[];
  /** Lines without an order id (advertising etc.) — never forced onto an order. */
  platformLines: SettlementLine[];
  totals: ReconciliationTotals;
  /** Sum of differences per cause, including `platform_level`. Sums to `totals.diff`. */
  byCause: Partial<Record<ReconciliationCause, number>>;
}

/** Fields the settlement import is allowed to write on an order. Never stock, never netPayoutExpected. */
export interface OrderSettlementUpdate {
  orderId: string;
  financialStatus: "Settled" | "PartiallySettled" | "Disputed";
  actualPayout: number;
  settledAt: number | null;
  settlementId: string;
}
