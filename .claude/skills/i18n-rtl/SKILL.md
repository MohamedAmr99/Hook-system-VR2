---
name: i18n-rtl
description: Use when adding or changing any user-facing text, labels, forms, tables, toasts or layout in this project: Arabic RTL UI and the i18n locale files.
---

# i18n & RTL

Project rule (CLAUDE.md): **all user-facing text is Arabic, RTL.** Code, comments, identifiers and commits are English.

- Locale files: `src/lib/i18n/locales/ar.json` (primary) and `en.json` (kept in sync as fallback; fallbackLng is `en`). Config: `src/lib/i18n/config.ts`.
- New UI text -> `t("feature.key")` via `useTranslation()`, Arabic string in `ar.json` and a matching key in `en.json`. Diff the key sets after editing; they already drift (en ~362 lines vs ar ~373). Don't make it worse, fix drift you touch.
- Many places still hardcode Arabic strings (e.g. errors in `orders/services/inventory.service.ts`, toasts). Moving them to `t()` is welcome when you touch the file; don't mass-refactor unrelated files.
- Services are not React: for user-facing errors thrown from services, keep Arabic text short and consistent, or throw a code and map it in the UI.
- Layout: logical Tailwind utilities (`ms-/me-/ps-/pe-/text-start/start-0`), not `ml/mr/pl/pr/left/right`; flip directional icons with `rtl:rotate-180`. Ensure `<html dir="rtl" lang="ar">`.
- Keep SKUs, order IDs, ASINs, emails and numbers in `dir="ltr"` spans. Format money/dates with `Intl.*` and `ar-EG`.
- Tables (`DataTable`) and recharts need an explicit RTL check (column order, tooltip, axis).

Done = both locale files updated, page checked visually in RTL.
