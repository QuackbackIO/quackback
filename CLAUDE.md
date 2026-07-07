# CLAUDE.md

Quackback - open-source customer feedback platform. Bun monorepo, TanStack Start, PostgreSQL + Drizzle, Tailwind v4 + shadcn/ui.

## Commands

```bash
bun run setup              # One-time setup (deps, Docker, migrations, seed)
bun run dev                # Dev server at localhost:3000 (login: demo@example.com / password)
bun run build && bun run db:generate && bun run db:migrate
bun run test && bun run test:e2e && bun run lint && bun run typecheck
```

## Rules

- Entity IDs are branded TypeIDs via `@quackback/ids`
- Never add co-author trailers to git commits
- When cutting a release, bump `version` in `apps/web/package.json` to match the git tag — this is the source of truth for `__APP_VERSION__` (injected at build time via Vite)
- Tier limits live in `settings.tier_limits` (JSON column) and are enforced via `getTierLimits()` + the helpers in `apps/web/src/lib/server/domains/settings/tier-enforce.ts`. The default (no row) is unlimited. The control-plane writes per-tenant limits via `/api/v1/internal/tier-limits` (scope-gated). The OSS code is unaware of "cloud" as a concept, so limits and their writer are the same mechanism for self-hosters and cloud tenants.

## UI sizing

Menus, filters, and list chrome follow one standard (see `MENU-FILTER-SIZING-STANDARD.md`). Two density tiers: **Compact (13px)** for menus, dropdowns, selects, filters, nav rails, toolbars, and chips; **Comfortable (14px)** for dialogs, settings form fields, and reading content. Apply sizes via the primitives and tokens, never hand-roll them:

- Menu / filter / nav row: use `MENU_ROW` + `MENU_ICON` from `@/components/ui/menu`, or the shadcn `DropdownMenuItem` / `SelectItem` / `CommandItem` (already 13px). Never override a menu item back to `text-xs` (lint enforces this).
- Chips / badges: `<Badge size="sm">` (11px meta) or default (12px), with `shape="pill"` for rounded pills. The floor is 11px: no `text-[10px]` on chips or labels.
- Compact select: `<SelectTrigger size="sm">` (h-8, 13px). Compact button: `size="sm"`. Compact icon button: `size="icon-sm"`.
- Section / eyebrow label: `MENU_LABEL` (11px uppercase). Icons: `size-4` in rows, `size-3.5` for chevrons.
