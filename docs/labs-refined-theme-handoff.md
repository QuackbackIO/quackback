# Labs + refined visual theme — handoff

Worktree: `/home/james/quackback/.worktrees/labs-refined-theme`  
Branch: `feat/labs-refined-visual-theme`  
Source commit: `615e4da2b61f66f5d764431e775bff3e0950ac58`  
Visual reference: `docs/visual-language-x-mockups.html`  
SHA-256: `bd24fbe532f02205b5b83c4867e7674d7d7d7acba85bcda2aab0f42bf2633b64`

Production was not enabled or deployed. The experiment defaults to `{ visible: false, enabled: false }` for every workspace. Missing rows mean both are false. The local `quackback` database was not migrated.

## What shipped

Reusable, database-backed Labs. First registered experiment: `refined-visual-theme` (“Refreshed UI”). When enabled, `visualTheme` becomes `refined` and `data-visual-theme="refined"` is set on `<html>`. When disabled or missing, the document marker is omitted and today’s styling is unchanged.

## State semantics

| Visible         | Enabled         | Labs UI                | Runtime           |
| --------------- | --------------- | ---------------------- | ----------------- |
| false / missing | false / missing | omitted                | legacy            |
| true            | false           | card shown, switch off | legacy            |
| true            | true            | card shown, switch on  | refined           |
| false           | true            | omitted                | **still refined** |

Hiding is not rollback. Rollback is a persisted `enabled=false` write through the service or operator CLI, then normal cache invalidation.

Workspace members with `settings.manage` can only enable/disable a **visible, registered** experiment. Visibility is operator-only. Unknown IDs never activate features or appear as cards.

## Operator commands

From this worktree (uses the current `DATABASE_URL` workspace unless `--hostname` is set):

```sh
bun --env-file=.env apps/web/scripts/labs-experiment.ts visible refined-visual-theme true
bun --env-file=.env apps/web/scripts/labs-experiment.ts visible refined-visual-theme false
bun --env-file=.env apps/web/scripts/labs-experiment.ts enabled refined-visual-theme true
bun --env-file=.env apps/web/scripts/labs-experiment.ts enabled refined-visual-theme false

# pooled fleet
bun --env-file=.env apps/web/scripts/labs-experiment.ts --hostname app.example.com visible refined-visual-theme true
```

Prints `{ experimentId, visible, enabled }` only. No secrets.

Local proof on disposable `quackback_labs_refined_theme`:

```text
visible true            → { visible: true,  enabled: false }
enabled true            → { visible: true,  enabled: true  }
visible false           → { visible: false, enabled: true  }   # hide ≠ rollback
enabled false           → { visible: false, enabled: false }   # rollback
unknown id              → exit 2, "unknown experiment"
non-boolean             → exit 2, usage
```

The worktree database was left `{ visible: false, enabled: false }`.

## Migration

- Identifier: `0281_workspace_experiments`
- File: `packages/db/drizzle/0281_workspace_experiments.sql`
- Journal idx: `258`, `when`: `1789386800000`
- Table: `workspace_experiments` (`settings_id`, `experiment_id` PK, both booleans `NOT NULL DEFAULT false`, FK cascade to `settings` named `workspace_experiments_settings_id_settings_id_fk`)

`bun run db:generate -- --name workspace_experiments` still fails: drizzle-kit reports a parent-snapshot collision among `0050`/`0051`/`0052`. SQL + journal matches recent repo practice.

Verified on disposable Postgres (never production):

| Database                       | Path                                      | Result                                   |
| ------------------------------ | ----------------------------------------- | ---------------------------------------- |
| `quackback_labs_fresh`         | empty → all migrations                    | table, FK, PK, NOT NULL, defaults        |
| `quackback_labs_refined_theme` | clone of local `quackback` at 0280 → 0281 | same, zero experiment rows after migrate |
| `quackback` (main local)       | untouched                                 | no `workspace_experiments` table         |

Insert without boolean columns stored `{ visible: false, enabled: false }`. Duplicate `(settings_id, experiment_id)` raised unique_violation. Updating `visible` did not overwrite `enabled` and vice versa.

`db:check-drift` is green. Composite-PK column-order rewrite on PG 17 is exempted for `workspace_experiments` (same class as the existing `status_incident_components` list). Pre-existing `slack_thread_sessions` PK rewrite was added to that same optional exemption so the check can pass.

## Branding cascade

1. Legacy or refined unbranded baseline, from the experiment.
2. Explicit workspace branding values (partial configs inherit unspecified keys from the selected baseline).
3. Existing custom CSS / preview overrides, same precedence as today.

`generateThemeCSS(config)` with no options stays legacy. Refined tokens use `:root:where([data-visual-theme="refined"])` / `.dark:where(...)` so they stay at `:root` / `.dark` specificity. The refined stylesheet is a **second** `<link>` after `globals.css` (not an `@import` inside it) so equal-specificity tokens win only when the marker is present, and later branding/custom CSS still wins. Admin does **not** start receiving portal branding.

## Document marker

- SSR: `data-visual-theme={visualThemeAttribute(theme)}` on `<html>` in `__root.tsx`. Legacy omits the attribute.
- Client: `VisualThemeSync` `useLayoutEffect` so widget `ssr: 'data-only'` and post-invalidate updates apply.
- Orthogonal to `.dark`, next-themes, and the visitor theme cookie. Widget/forced-preview cookie protection is unchanged.

## Route coverage

Shared primitives (`styles/labs/refined-theme.css` + token/radius/shadow baseline) apply whenever the document marker is present: admin shell, Feedback, Support, Roadmap, Changelog, Help Center, Status, Analytics, AI & Automation, Users, Settings (including Labs), public portal, Messenger/widget, branded auth. Page anatomy, editors, bulk actions, and workflows are unchanged.

Not applicable (out of this repository’s theme scope, or machine endpoints):

- Control-plane app, marketing site, transactional email, Stripe-hosted Checkout
- API/webhooks/health/internal fleet routes
- Widget launcher styles on third-party host pages

Entry/error flows use legacy until a workspace is resolved (`visualTheme` defaults to `legacy`).

## Cache / client refresh

`visualTheme` is loaded with `getWorkspaceSettings` (cache key `settings:workspace`, workspace-keyed in `kv_store`). Successful Labs writes call `kvDel` (not `cacheDel`, which swallows errors). Failed invalidation is `SETTINGS_CACHE_INVALIDATION_FAILED`. The Labs switch does not flip the document until persist + `router.invalidate()` succeed. Other open documents pick up the change on their next navigation/refresh — no realtime channel.

Anonymous changelog / status / Help Center documents still use `public, s-maxage=60, stale-while-revalidate=600`. That is the same lag branding already has. Cookie-bearing admin and widget (`no-store`) refresh immediately.

## Checks

| Check                                                                     | Result                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Labs/resolver/service/nav/theme/settings-cache/lab-sections tests | Pass (121)                                                                                                                                      |
| Theme suite + replay-safety + Labs                                        | Pass (146)                                                                                                                                      |
| Settings suites that call `getWorkspaceSettings` (help-center, portal OG) | Pass after mock `.where()`                                                                                                                      |
| `@quackback/db` typecheck                                                 | Pass                                                                                                                                            |
| `@quackback/web` typecheck                                                | Pass                                                                                                                                            |
| `oxlint` on new Labs/theme files                                          | Pass                                                                                                                                            |
| `git diff --check`                                                        | Pass                                                                                                                                            |
| `bun run db:generate`                                                     | Failed: snapshot collision (documented)                                                                                                         |
| `bun run db:migrate`                                                      | Pass on fresh + upgrade disposable DBs                                                                                                          |
| `bun run db:check-drift`                                                  | Pass                                                                                                                                            |
| Operator CLI matrix                                                       | Pass (see above)                                                                                                                                |
| `bun run --filter @quackback/web build`                                   | Pass (exit 0; pre-existing zod `validate` warnings)                                                                                             |
| `bun run test:e2e -- settings-labs`                                       | Spec added; not executed here (needs signed-in e2e harness)                                                                                     |
| Live SSR on `http://localhost:3017`                                       | Changelog + widget: no marker when off; `data-visual-theme="refined"` when hidden+enabled; marker gone on a fresh request after `enabled=false` |

## Remaining risks

- Browser-verify admin, portal, auth, and widget after revealing/enabling locally. Phase 0 legacy screenshots were not captured (no running tenant at start).
- `drizzle-kit generate` remains unusable until snapshots are repaired; future Labs tables should follow the same SQL+journal path or fix snapshots first.
- Other open tabs lag until navigation.
- Hidden+enabled stays active until an operator disables it.
- Anonymous public HTML may lag up to 60s / SWR 10min after disable, same as branding.

## Changed paths (high level)

- `packages/db/src/schema/labs.ts`, schema barrel, types, `0281_workspace_experiments.sql`, journal, drift exemptions
- `apps/web/src/lib/shared/labs/*`
- `apps/web/src/lib/server/domains/settings/settings.labs.ts` (+ tests)
- `apps/web/src/lib/server/functions/labs.ts`
- `apps/web/scripts/labs-experiment.ts`
- Settings projection, cache repair, Labs page/nav, document marker
- Theme expand/generator + `styles/labs/refined-theme.css`
- Portal/widget/auth branding CSS consumers
- `docs/visual-language-x-mockups.html`, this handoff
