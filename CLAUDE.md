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
- `EDITION=cloud` enables tier-limit enforcement, internal control-plane endpoints, and upgrade UI. Anything else (default `oss`) is the self-hosted bundle: tier-limits resolver short-circuits to unlimited, internal endpoints 404, upgrade UI is hidden. There are exactly three checkpoints that read `IS_CLOUD` (`apps/web/src/lib/server/edition.ts`); never add a fourth. Cloud-only logic that doesn't fit one of those three belongs in the control-plane repo, not gated inline.
