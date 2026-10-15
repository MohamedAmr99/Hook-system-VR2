import type { Order } from "@/features/orders/types/order.types";
import type { Return } from "@/features/returns/types/return.types";
import type {
  OrderSettlementUpdate,
  ReconciliationReport,
  SettlementLine,
  StatementParseResult,
} from "../types/settlement.types";
import { settlementRepository } from "../repositories/settlement.repository";
import { parseAmazonStatementCsv } from "../parsers/amazonStatementCsv.parser";
import { buildOrderSettlementUpdates, reconcileSettlement, sumLineTotals } from "./reconcile.logic";

export interface SettlementPreview {
  parse: StatementParseResult;
  report: ReconciliationReport;
  /** Sum of the "الإجمالي" column of this file only. */
  statementTotal: number;
  /** Lines from earlier imports merged into the reconciliation (not re-saved). */
  priorLineCount: number;
}

export interface SettlementImportOutcome {
  savedLines: number;
  updates: OrderSettlementUpdate[];
  updatedOrderIds: string[];
  missingOrderIds: string[];
}

export class SettlementService {
  /** Parse + reconcile. Reads earlier stored lines for the same orders; performs no writes. */
  static async previewAmazonStatement(
    csvText: string,
    ctx: { orders: readonly Order[]; returns: readonly Return[]; userId: string },
  ): Promise<SettlementPreview> {
    const parse = parseAmazonStatementCsv(csvText, { importedBy: ctx.userId, importedAt: Date.now() });

    let prior: SettlementLine[] = [];
    if (parse.lines.length > 0) {
      const orderIds = parse.lines.map((l) => l.platformOrderId).filter((id): id is string => Boolean(id));
      const currentIds = new Set(parse.lines.map((l) => l.id));
      prior = (await settlementRepository.getLinesByOrderIds(orderIds)).filter((l) => !currentIds.has(l.id));
    }

    const report = reconcileSettlement({
      lines: [...parse.lines, ...prior],
      orders: ctx.orders,
      returns: ctx.returns,
      platform: "Amazon",
      notInSheetWindow: parse.period ? { from: parse.period.from, to: parse.period.to } : undefined,
    });

    return { parse, report, statementTotal: sumLineTotals(parse.lines), priorLineCount: prior.length };
  }

  /**
   * Saves lines under deterministic ids (idempotent), then writes financialStatus / actualPayout /
   * settledAt on matched orders. Never touches stock and never overwrites netPayoutExpected.
   */
  static async confirmAmazonStatement(preview: SettlementPreview, userId: string): Promise<SettlementImportOutcome> {
    if (!preview.parse.period || preview.parse.lines.length === 0) {
      return { savedLines: 0, updates: [], updatedOrderIds: [], missingOrderIds: [] };
    }
    const savedLines = await settlementRepository.upsertLines(preview.parse.lines);
    const now = Date.now();
    const updates = buildOrderSettlementUpdates(preview.report, preview.parse.period.key, now);
    const { updatedOrderIds, missingOrderIds } = await settlementRepository.applyOrderSettlements(updates, userId, now);
    return { savedLines, updates, updatedOrderIds, missingOrderIds };
  }
}
