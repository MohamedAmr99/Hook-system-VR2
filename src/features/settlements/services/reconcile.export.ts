import type { ReconciliationCause, ReconciliationReport } from "../types/settlement.types";

export interface ReconciliationCsvLabels {
  headers: {
    orderId: string;
    match: string;
    expected: string;
    actual: string;
    diff: string;
    causes: string;
    status: string;
  };
  match: Record<"matched" | "missing_in_system" | "not_in_sheet", string>;
  cause: (cause: ReconciliationCause) => string;
  status: (status: string | null) => string;
  platformLevelRow: string;
}

function csvCell(value: string | number): string {
  const s = typeof value === "number" ? value.toFixed(2) : value;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per order id plus one row per platform-level line. BOM-prefixed so Excel shows Arabic. */
export function buildReconciliationCsv(report: ReconciliationReport, labels: ReconciliationCsvLabels): string {
  const h = labels.headers;
  const out: string[] = [[h.orderId, h.match, h.expected, h.actual, h.diff, h.causes, h.status].map(csvCell).join(",")];
  for (const r of report.results) {
    const causes = r.causes.map((c) => `${labels.cause(c.cause)}: ${c.amount.toFixed(2)}`).join(" | ");
    out.push(
      [r.platformOrderId, labels.match[r.match], r.expected, r.actual, r.diff, causes, labels.status(r.financialStatus)]
        .map(csvCell)
        .join(","),
    );
  }
  for (const l of report.platformLines) {
    out.push(
      [labels.platformLevelRow, l.description, 0, l.total, l.total, labels.cause("platform_level"), labels.status(null)]
        .map(csvCell)
        .join(","),
    );
  }
  return String.fromCharCode(0xfeff) + out.join("\r\n") + "\r\n";
}
