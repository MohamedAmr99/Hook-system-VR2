import type {
  ParseIssue,
  SettlementLine,
  SettlementLineKind,
  StatementParseResult,
  StatementPeriod,
} from "../types/settlement.types";

/**
 * Parser for Amazon's Arabic "Transactions for statement period" CSV
 * (المعاملات لفترة كشف الحساب). Columns are mapped by Arabic header name, never by position.
 */

type ColumnKey =
  | "date"
  | "type"
  | "orderId"
  | "description"
  | "productCharges"
  | "promotions"
  | "platformFees"
  | "other"
  | "total";

/** Header name (normalized) -> column key. `total` matches by prefix because of the "(EGP)" suffix. */
const HEADER_NAMES: Record<Exclude<ColumnKey, "total">, string> = {
  date: "التاريخ",
  type: "نوع المعاملة",
  orderId: "رقم الطلب",
  description: "تفاصيل المنتج",
  productCharges: "إجمالي رسوم المنتج",
  promotions: "إجمالي التخفيضات",
  platformFees: "رسوم أمازون",
  other: "أخرى",
};
const TOTAL_HEADER_PREFIX = "الإجمالي";
const REQUIRED_COLUMNS: readonly ColumnKey[] = ["date", "type", "orderId", "total"];

const SALE_TYPES = ["مبلغ الطلب", "order payment"];
const REFUND_TYPES = ["استرداد", "refund"];
const PLATFORM_ORDER_PLACEHOLDERS = ["", "---", "--", "-"];

export interface ParseOptions {
  importedBy: string;
  importedAt: number;
}

/** RFC-4180 style CSV: quoted fields, escaped quotes (""), commas/newlines inside quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function normalizeHeader(h: string): string {
  return h.replace(new RegExp(String.fromCharCode(0xfeff), "g"), "").replace(/\s+/g, " ").trim();
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
function toLatinDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Parses "1,234.50", "-53.9", "١٢٣٫٥", "(12.00)". Returns null when not a number; "" -> 0. */
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  let s = toLatinDigits(raw.trim()).replace(/٫/g, ".").replace(/[,٬\s]/g, "");
  if (s === "") return 0;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

/** dd/MM/yyyy (also dd-MM-yyyy / dd.MM.yyyy) -> { ms at local midnight, key yyyy-MM-dd }. */
export function parseStatementDate(raw: string): { ms: number; key: string } | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(toLatinDigits(raw.trim()));
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ms: d.getTime(), key };
}

export function extractSafetClaimId(description: string): string | null {
  const m = /SAFE-?T[^\d]*(\d[\d-]*\d)/i.exec(description);
  return m ? m[1] : null;
}

export function classifyStatementRow(rawType: string, description: string): SettlementLineKind {
  const type = rawType.trim().toLowerCase();
  const desc = description.trim();
  if (SALE_TYPES.includes(type)) return "sale";
  if (REFUND_TYPES.includes(type)) return "refund";
  if (/SAFE-?T/i.test(desc)) return "safet_claim";
  if (type === "cancellation" || desc.includes("رسوم الإلغاء")) return "cancellation_fee";
  if (desc.includes("الشحن السهل") || /easy\s*ship/i.test(desc)) return "easy_ship_fee";
  if (/advertis/i.test(desc) || desc.includes("إعلان")) return "advertising";
  return "other";
}

/** FNV-1a 32-bit, hex. Only used to make ids of free-text rows stable. */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function sanitizeIdPart(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Deterministic Firestore id: platform + order + kind + date + amount (+ claim / description hash)
 * + occurrence index of identical rows within the file. The statement period is deliberately NOT
 * part of the id, so two overlapping exports that contain the same transaction map to one doc.
 */
export function buildSettlementLineId(
  line: Pick<SettlementLine, "platformOrderId" | "kind" | "dateKey" | "total" | "safetClaimId" | "description">,
  occurrence: number,
): string {
  const parts = [
    "amz",
    line.platformOrderId ? sanitizeIdPart(line.platformOrderId) : "platform",
    line.kind,
    line.dateKey.replace(/-/g, ""),
    String(Math.round(line.total * 100)),
  ];
  if (line.safetClaimId) parts.push(sanitizeIdPart(line.safetClaimId));
  if (line.kind === "other" || line.kind === "advertising") parts.push(shortHash(line.description.trim()));
  parts.push(String(occurrence));
  return parts.join("_");
}

function periodKey(fromKey: string, toKey: string): string {
  return `${fromKey}_${toKey}`;
}

export function parseAmazonStatementCsv(text: string, options: ParseOptions): StatementParseResult {
  const errors: ParseIssue[] = [];
  const warnings: ParseIssue[] = [];
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { lines: [], errors: [{ row: 0, message: "empty_file" }], warnings, period: null };
  }

  const headers = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<ColumnKey, number>> = {};
  headers.forEach((h, i) => {
    if (h.startsWith(TOTAL_HEADER_PREFIX)) {
      colIndex.total = i;
      return;
    }
    for (const [key, name] of Object.entries(HEADER_NAMES) as [Exclude<ColumnKey, "total">, string][]) {
      if (h === name) colIndex[key] = i;
    }
  });

  const missing = REQUIRED_COLUMNS.filter((k) => colIndex[k] === undefined);
  if (missing.length > 0) {
    return {
      lines: [],
      errors: [{ row: 0, message: `missing_columns:${missing.join(",")}` }],
      warnings,
      period: null,
    };
  }

  const cell = (cells: string[], key: ColumnKey): string => {
    const idx = colIndex[key];
    return idx !== undefined && cells[idx] !== undefined ? cells[idx].trim() : "";
  };

  type Draft = Omit<SettlementLine, "id" | "statementId">;
  const drafts: Draft[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const rowNumber = r;

    const date = parseStatementDate(cell(cells, "date"));
    if (!date) {
      errors.push({ row: rowNumber, message: "invalid_date" });
      continue;
    }
    const total = parseAmount(cell(cells, "total"));
    if (total === null) {
      errors.push({ row: rowNumber, message: "invalid_total" });
      continue;
    }

    const num = (key: ColumnKey): number => {
      const v = parseAmount(cell(cells, key));
      if (v === null) {
        warnings.push({ row: rowNumber, message: `invalid_number:${key}` });
        return 0;
      }
      return v;
    };
    const productCharges = num("productCharges");
    const promotions = num("promotions");
    const platformFees = num("platformFees");
    const other = num("other");

    const componentsCents =
      Math.round(productCharges * 100) + Math.round(promotions * 100) +
      Math.round(platformFees * 100) + Math.round(other * 100);
    if (componentsCents !== Math.round(total * 100)) {
      warnings.push({ row: rowNumber, message: "components_do_not_match_total" });
    }

    const rawType = cell(cells, "type");
    const description = cell(cells, "description");
    const rawOrderId = cell(cells, "orderId");
    const platformOrderId = PLATFORM_ORDER_PLACEHOLDERS.includes(rawOrderId) ? null : rawOrderId;
    const kind = classifyStatementRow(rawType, description);

    drafts.push({
      platform: "Amazon",
      source: "amazon_statement_csv",
      kind,
      rawType,
      date: date.ms,
      dateKey: date.key,
      platformOrderId,
      description,
      safetClaimId: kind === "safet_claim" ? extractSafetClaimId(description) : null,
      productCharges,
      promotions,
      platformFees,
      other,
      total,
      rowNumber,
      importedAt: options.importedAt,
      importedBy: options.importedBy,
    });
  }

  if (drafts.length === 0) return { lines: [], errors, warnings, period: null };

  const sortedKeys = drafts.map((d) => d.dateKey).sort();
  const fromKey = sortedKeys[0];
  const toKey = sortedKeys[sortedKeys.length - 1];
  const fromMs = Math.min(...drafts.map((d) => d.date));
  const toMs = Math.max(...drafts.map((d) => d.date));
  const period: StatementPeriod = { from: fromMs, to: toMs, key: periodKey(fromKey, toKey) };

  const occurrences = new Map<string, number>();
  const lines: SettlementLine[] = drafts.map((d) => {
    const base = buildSettlementLineId(d, 0);
    const n = occurrences.get(base) ?? 0;
    occurrences.set(base, n + 1);
    return { ...d, id: buildSettlementLineId(d, n), statementId: period.key };
  });

  return { lines, errors, warnings, period };
}
