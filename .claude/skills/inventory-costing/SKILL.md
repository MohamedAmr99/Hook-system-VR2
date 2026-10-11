---
name: inventory-costing
description: Use when touching stock quantities, reservations, shipping/cancel stock transitions, returns restock, purchases, COGS or weighted average cost in this project.
---

# Inventory, reservation & costing

Rules of record are in `CLAUDE.md` (stock lifecycle, state machine, returns, WAC). This skill is the how-to.

## Live stock model (products collection)
`availableQuantity = quantity - reservedQuantity - unavailableQuantity`
- Order created -> `reservedQuantity += qty`, order `stockState: "reserved"` (`createOrderAtomic` in `features/orders/services/inventory.service.ts`, inside `runTransaction`, rejects overselling).
- Order edited -> apply the per-product delta to `reservedQuantity` (`updateOrderAtomic`).
- Order **Shipped** -> deduct physical `quantity` once and release the reservation; `stockState: "deducted"`. Never deduct on Delivered. Check `stockState` first so retries are idempotent.
- Order cancelled (Pending/Processing only) -> release `reservedQuantity` only; `stockState: "released"`.
- Return (`features/returns`): restock only if `returnCondition === "healthy" && restocked`; damaged/missing parts go to `unavailableQuantity` or nowhere, never to sellable stock. Toggling `restocked` off must reverse exactly what was added.
- `fba_virtual` warehouses are read-only mirrors of Amazon: no local reservation logic.

## Rules for any stock write
1. Read and write inside one `runTransaction` (reads before writes). Never read stock from the Zustand store to decide a write.
2. Don't `.catch(() => {})` around a stock transaction: swallowing errors silently corrupts stock (several helpers in `inventory.service.ts` and `return.service.ts` do this today). Surface the error or rethrow.
3. Don't `Math.max(0, ...)` away a negative result silently; negative stock is a bug to report.
4. After a Firestore stock change, keep the local `useStore` copy in sync or invalidate the query. They are two sources of truth today (known debt).

## Cost (WAC)
- On purchase: `newWAC = (oldStock*oldWAC + qty*unitCost) / (oldStock+qty)`; write `costHistory`, update `product.costPrice` (`costing.service.ts`, called from `purchase.service.ts`).
- Sales/returns never change WAC. `unitCogs` is snapshotted on the order item **at shipment** and reused for returns.
- Editing/deleting a purchase = reverse its effect, then re-apply.
- Order profit always comes from `calculateOrderFinancials` (`shared/utils/orderCalculations.ts`), never recomputed inline.

## Tests
Pure logic lives in `shared/utils` with vitest tests in `__tests__/` (`inventoryAndPayments.test.ts`, `orderCalculations.test.ts`). Add a test for every new calculation; run `npm test`.

Worked check: buy 10@5, buy 10@7 -> WAC 6; reserve 5 -> available 15; ship -> quantity 15, reserved 0; cancel after ship is not allowed.
