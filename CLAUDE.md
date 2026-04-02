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
