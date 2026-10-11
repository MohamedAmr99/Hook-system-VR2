---
name: marketplace-settlements
description: Use when working on Amazon/Noon/Jumia settlement import and parsing, order import, fee reconciliation, bank-statement CSVs, or the pricing calculator in this project.
---

# Marketplace settlements & imports

Files: `features/settlements/{services/amazonParser.service.ts,services/settlement.service.ts,repositories,schemas,components/SettlementImportModal.tsx}`, `features/finance/components/SettlementImportModal.tsx` (a second copy: consolidate, don't fork again), `orders/components/OrderImportModal.tsx`, `shared/components/UploadZone.tsx`, `features/calculator`.

- Amazon settlement report is TSV: rows 1-7 header info, row 8 column names, data from row 9. Map by column name (lower-cased/trimmed); missing columns -> 0/"" not a crash; strip thousands separators; handle `\r\n`; keep signs of fees/refunds.
- `SettlementService.importAmazonSettlement` saves raw records in chunks (450), then matches by `platformOrderId` and marks orders `Settled` with the actual `netPayoutExpected`. It updates orders through the Zustand store; keep it consistent with where orders actually live.
- **Idempotency**: re-importing the same file must not duplicate records or double-count. Dedupe on settlement-id + order-id + sku + amount-type before writing.
- Flow: parse -> preview with per-row errors -> user confirms -> save -> reconcile -> report unmatched rows and discrepancies (expected vs actual payout). Disputed/unmatched orders get `financialStatus: "Disputed"`, never silently ignored.
- Use real sample files only (never invent columns); fixtures under `src/features/settlements/__fixtures__/`. Root-level statement CSVs (bank statement exports) are private data: don't commit or print their contents.
- Pricing calculator: referral fee %, fulfillment fee, WAC (`costPrice`), shipping; keep as a pure function with tests.
