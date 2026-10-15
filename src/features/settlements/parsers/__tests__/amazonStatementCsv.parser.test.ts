import { describe, it, expect } from "vitest";
import fixture from "../../__fixtures__/amazon-statement.anonymized.csv?raw";
import {
  buildSettlementLineId,
  classifyStatementRow,
  extractSafetClaimId,
  parseAmazonStatementCsv,
  parseAmount,
  parseCsv,
  parseStatementDate,
} from "../amazonStatementCsv.parser";

const opts = { importedBy: "u1", importedAt: 1 };

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, commas in fields and CRLF", () => {
    const rows = parseCsv(String.fromCharCode(0xfeff) + '"a","b"\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("parseAmount / parseStatementDate", () => {
  it("strips thousands separators and keeps signs", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("-53.9")).toBe(-53.9);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("١٬٢٣٤٫٥")).toBe(1234.5);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("abc")).toBeNull();
  });
  it("parses dd/MM/yyyy and rejects impossible dates", () => {
    expect(parseStatementDate("18/09/2026")?.key).toBe("2026-09-18");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("")).toBeNull();
  });
});

describe("classifyStatementRow", () => {
  it("maps each row type of the Arabic statement", () => {
    expect(classifyStatementRow("مبلغ الطلب", "x")).toBe("sale");
    expect(classifyStatementRow("استرداد", "x")).toBe("refund");
    expect(classifyStatementRow("رسوم الخدمة", "رسوم الشحن السهل من أمازون")).toBe("easy_ship_fee");
    expect(classifyStatementRow("Cancellation", "رسوم الإلغاء")).toBe("cancellation_fee");
    expect(classifyStatementRow("رسوم الخدمة", "Cost of Advertising")).toBe("advertising");
    expect(classifyStatementRow("أخرى", "رقم مطالبة SAFE-T 00000-00000-0000001")).toBe("safet_claim");
    expect(classifyStatementRow("أخرى", "something new")).toBe("other");
  });
  it("extracts the SAFE-T claim number", () => {
    expect(extractSafetClaimId("رقم مطالبة SAFE-T 00000-00000-0000001")).toBe("00000-00000-0000001");
    expect(extractSafetClaimId("no claim")).toBeNull();
  });
});

describe("parseAmazonStatementCsv (fixture)", () => {
  const result = parseAmazonStatementCsv(fixture, opts);

  it("parses every row by Arabic header name without errors", () => {
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.lines).toHaveLength(11);
    expect(result.period?.key).toBe("2026-09-18_2026-10-02");
  });

  it("classifies rows, keeps signs and nulls platform-level order ids", () => {
    const kinds = result.lines.map((l) => l.kind);
    expect(kinds.filter((k) => k === "sale")).toHaveLength(4);
    expect(kinds.filter((k) => k === "refund")).toHaveLength(2);
    expect(kinds.filter((k) => k === "easy_ship_fee")).toHaveLength(2);
    const ads = result.lines.find((l) => l.kind === "advertising");
    expect(ads?.platformOrderId).toBeNull();
    expect(ads?.total).toBe(-1500);
    const refund = result.lines.find((l) => l.kind === "refund" && l.platformOrderId === "402-0000000-0000002");
    expect(refund).toMatchObject({ productCharges: -1000, platformFees: 78, other: -38, total: -960 });
    const sale = result.lines[0];
    expect(sale.description).toBe("Test Product A, black...");
    const safet = result.lines.find((l) => l.kind === "safet_claim");
    expect(safet?.safetClaimId).toBe("00000-00000-0000001");
  });

  it("is order-independent: columns are found by name", () => {
    const swapped = '"الإجمالي (EGP)","رقم الطلب","نوع المعاملة","التاريخ"\n"10","1","مبلغ الطلب","01/10/2026"\n';
    const r = parseAmazonStatementCsv(swapped, opts);
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ total: 10, platformOrderId: "1", kind: "sale", productCharges: 0, other: 0 });
  });

  it("reports missing required columns and bad rows instead of crashing", () => {
    expect(parseAmazonStatementCsv('"foo","bar"\n"1","2"\n', opts).errors[0].message).toMatch(/^missing_columns:/);
    const bad = '"التاريخ","نوع المعاملة","رقم الطلب","الإجمالي"\n"xx","مبلغ الطلب","1","5"\n"01/10/2026","مبلغ الطلب","1","oops"\n';
    const r = parseAmazonStatementCsv(bad, opts);
    expect(r.lines).toHaveLength(0);
    expect(r.errors.map((e) => e.message)).toEqual(["invalid_date", "invalid_total"]);
  });
});

describe("deterministic ids (idempotent re-import)", () => {
  it("re-parsing the same file yields the same ids, independent of import time/user", () => {
    const a = parseAmazonStatementCsv(fixture, opts).lines.map((l) => l.id);
    const b = parseAmazonStatementCsv(fixture, { importedBy: "u2", importedAt: 999 }).lines.map((l) => l.id);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it("identical rows in one file get distinct occurrence suffixes", () => {
    const ids = parseAmazonStatementCsv(fixture, opts)
      .lines.filter((l) => l.platformOrderId === "402-0000000-0000004")
      .map((l) => l.id);
    expect(ids).toHaveLength(2);
    expect(ids[0].endsWith("_0")).toBe(true);
    expect(ids[1].endsWith("_1")).toBe(true);
  });

  it("an overlapping export with a different period maps shared rows to the same ids", () => {
    const rows = fixture.split("\n");
    const subset = [rows[0], rows[1], rows[2]].join("\n");
    const full = parseAmazonStatementCsv(fixture, opts).lines;
    const part = parseAmazonStatementCsv(subset, opts).lines;
    expect(part[0].statementId).not.toBe(full[0].statementId);
    expect(part.map((l) => l.id)).toEqual(full.slice(0, 2).map((l) => l.id));
  });

  it("id includes order, kind, date and amount in cents", () => {
    expect(
      buildSettlementLineId(
        { platformOrderId: "402-1", kind: "sale", dateKey: "2026-09-18", total: 480.5, safetClaimId: null, description: "" },
        0,
      ),
    ).toBe("amz_402-1_sale_20260918_48050_0");
  });
});
