---
name: double-entry-ledger
description: Use when posting or changing financial transactions, ledger entries, accounts, expenses, loans, collections or anything that moves money in this project.
---

# Double-entry ledger & financial truth

**Know which financial layer you are in.**
1. **Operational/live layer**: Zustand `useStore` (orders, expenses, collections, purchases) + `calculateOrderFinancials` in `shared/utils/orderCalculations.ts`. This is what the Orders page, Returns page and Dashboard show. Profit/loss numbers must come only from this helper (single source of truth).
2. **Ledger layer**: `features/finance/services/ledger.service.ts` (`postTransaction`), used by `purchase.service.ts` and `order.service.ts`. Grep who actually calls it before assuming it drives the UI; `OrderService.createOrder` is partly dormant (`@ts-nocheck`, placeholder stock values).

Don't create a third path. New money logic = pure function in `shared/utils` (+ vitest test), wired to the layer the screen already uses.

## Ledger rules
- Post only via `ledgerService.postTransaction(tx, entries)`: it rejects unbalanced entries (sum debit == sum credit within 0.01) and writes in one `writeBatch`.
- Transaction types: `OrderSale`, `OrderRefund`, `PurchasePayment`, `MarketplaceSettlement`, `MarketplaceFee`, `ExpensePayment`, `Transfer`. Extend the union first.
- Sale: Dr receivable + fees + COGS = Cr revenue + inventory asset. Refund/return: reverse. Settlement: Dr bank/cash, Cr receivable. Corrections are reversing transactions, never edits.
- Account IDs are hardcoded strings (`marketplace_receivable`, `sales_revenue`, `cogs`, `inventory_asset`, ...): centralize in one constants file instead of adding literals.
- Round each line to 2 dp; push the remainder onto the largest line so it balances exactly.

## Returns money
Net return yield = compensation - customer refund - retained fees - irrecoverable COGS (damaged only). Partial returns use the returned item's `unitCogs x returned qty`, not the order total.

Show a worked numeric example when you change a formula, and cover it with a test.
