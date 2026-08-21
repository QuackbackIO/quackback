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
- Never name competitor or third-party products in source, comments, commit messages, migrations, or test fixtures — describe the pattern instead ("chat-style composer", "no approval step"). This does not apply to the products we genuinely integrate with (`apps/web/src/integrations/**`, import sources, the README integrations list) or to our own names (Quackback, Quinn).
- When cutting a release, bump `version` in `apps/web/package.json` to match the git tag — this is the source of truth for `__APP_VERSION__` (injected at build time via Vite)
- Tier limits live in `settings.tier_limits` (JSON column) and are enforced via `getTierLimits()` + the helpers in `apps/web/src/lib/server/domains/settings/tier-enforce.ts`. The default (no row) is unlimited, and a self-hosted operator can still write limits via the declarative config file (`/etc/quackback/config.yaml`).
- Commercial state (plans, entitlements) lives in the default-off `settings.cloud` block, resolved by `apps/web/src/lib/server/domains/settings/cloud/`. An install with no cloud block is entitled to everything — `isEntitled()` checks `enabled: false` first, before any stored value — and never makes an outbound control-plane request. Entitlements sit alongside the numeric tier-limit helpers, never in front of them: `requireEntitlement()` answers "does the plan include it", `enforce*Budget()` answers "is there budget left". The hosted service writes this block via signed, monotonic projections; nothing in this repo mints one.

## UI sizing

Menus, filters, and list chrome follow one standard. Two density tiers: **Compact (13px)** for menus, dropdowns, selects, filters, nav rails, toolbars, and chips; **Comfortable (14px)** for dialogs, settings form fields, and reading content. Apply sizes via the primitives and tokens, never hand-roll them:

- Menu / filter / nav row: use `MENU_ROW` + `MENU_ICON` from `@/components/ui/menu`, or the shadcn `DropdownMenuItem` / `SelectItem` / `CommandItem` (already 13px). Never override a menu item back to `text-xs` (lint enforces this).
- Chips / badges: `<Badge size="sm">` (11px meta) or default (12px), with `shape="pill"` for rounded pills. The floor is 11px: no `text-[10px]` on chips or labels.
- Compact select: `<SelectTrigger size="sm">` (h-8, 13px). Compact button: `size="sm"`. Compact icon button: `size="icon-sm"`.
- Section / eyebrow label: `MENU_LABEL` (11px uppercase). Icons: `size-4` in rows, `size-3.5` for chevrons.
