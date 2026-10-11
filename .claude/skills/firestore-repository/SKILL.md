---
name: firestore-repository
description: Use when adding or changing Firestore data access in this project: new collections, repositories, queries, transactions, or React Query/Zustand wiring over them.
---

# Firestore access

1. Repositories: `features/<f>/repositories/<name>.repository.ts` extending `BaseRepository<T>` (`src/lib/firebase/repository.ts`, currently `@ts-nocheck`; type it when you touch it). Services call repositories; pages call services/hooks. No `firebase/firestore` imports in pages/components.
2. Timestamps are `number` (`Date.now()`); money is a number rounded to 2 dp in services.
3. **Transactions**: any read-then-write (stock, balances, state transitions) uses `runTransaction` with all reads first; pure multi-doc writes use `writeBatch` (max 500 ops). See `orders/services/inventory.service.ts`. Don't swallow errors with `.catch(() => {})`.
4. **Two data sources today**: some entities live in the persisted Zustand store (`shared/store/useStore.ts`, `@ts-nocheck`) while others use TanStack Query. Before changing an entity, find which one the screen reads (Grep `useStore` and `useQuery`). Server state belongs in TanStack Query; Zustand is for UI state only (CLAUDE.md). Migrating an entity off the store is a deliberate task: do the whole entity, not half.
5. After a mutation, invalidate every dependent query (orders -> products, dashboard stats, returns).
6. Compound queries need an index in `firestore.indexes.json`; security needs matching rules (`firebase-security` agent).
7. No `any`; use types from `features/*/types`.
