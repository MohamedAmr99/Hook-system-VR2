---
name: verify
description: Use before declaring any change in this project done: runs tests, lint and the type-checked build and reports real results.
---

# Verify

From the repo root, in order; report actual output, never assume success:

```bash
npm test          # vitest run (shared/utils tests)
npm run lint
npm run build     # tsc -b && vite build
```

- `@ts-nocheck` files (`repository.ts`, `order.service.ts`, `useStore.ts`, ...) hide type errors: say so if you edited one.
- UI change: run `npm run dev` and check in RTL Arabic.
- Money/stock change: add or update a vitest test and give one worked numeric example.
- Separate pre-existing failures from ones you introduced.
