# Fork Conventions — Staying Mergeable with Upstream Quackback

> **Status:** Adopted (decision D1/D2 in `01-decisions.md`). Every v2 plan must follow this document.
> **Applies to:** all fork-owned features (RBAC extensions, prioritization, tiered support, account
> actions, announcements, control tower).

## 1. Posture

- **This is a long-lived fork.** Features are not contributed upstream by default (decision D1). We
  therefore optimise for **the smallest possible surface of edits to upstream-owned files**, and for
  merges that are mechanical.
- Upstream moves fast (~1,100 commits / 90 days at time of writing). Assume every upstream file we
  touch will conflict eventually. The goal is that each conflict is **small, obvious, and grep-able**.
- **What we promise:** a *maintained, tested fork that can take upstream releases* — not conflict-free
  upgrades (staff review, `03-staff-review.md`). Sidecar tables and fork modules still depend on upstream tables,
  domain internals and a reserved upstream column; a clean Git merge is not proof of behavioural safety. Keeping
  seam counts small is a goal, never a reason to skip an essential fix: add the seam.
- **Upstream PRs are case by case** (D1). Default is fork-only. Currently: the 2FA-reset / force-sign-out
  target guard **is** offered upstream (D-A14); the custom-roles-on-REST/MCP fix and per-app inbound email
  are **not** — they are permanent fork patches.

## 2. Where fork code lives

| Kind                           | Location                                                                    | Notes                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate apps                  | `apps/control-tower/` (and any future fork app)                             | Wholly fork-owned. Never conflicts.                                                                                                                                           |
| DB schema (tenant DB)          | `packages/db/src/fork/schema/*.ts` + barrel `packages/db/src/fork/index.ts` | **Not** exported from `packages/db/src/schema/index.ts`. Query with the core builder (`db.select().from(forkTable)`); avoid `db.query.<forkTable>` (needs the upstream barrel). |
| DB migrations (tenant DB)      | `packages/db/drizzle-fork/*.sql` + `drizzle-fork/meta/_journal.json`        | Separate lineage + separate ledger table. See §3.                                                                                                                             |
| Server domain logic            | `apps/web/src/lib/server/fork/<feature>/`                                   | Inside upstream's module-state scan roots **on purpose** — fork code must pass the same checks without ledger entries (§6).                                                   |
| Server functions (RPC)         | `apps/web/src/lib/server/fork/<feature>/functions.ts`                       | Picked up by the authz-matrix scan (it walks all of `apps/web/src`).                                                                                                          |
| MCP tools                      | `apps/web/src/lib/server/mcp/tools/fork-<feature>.ts`                       | Must live in `mcp/tools/` so the authz-matrix MCP scan attests them. Registered via one seam line.                                                                            |
| Shared (client+server) types   | `apps/web/src/lib/shared/fork/<feature>/`                                   |                                                                                                                                                                               |
| React components               | `apps/web/src/components/fork/<feature>/`                                   |                                                                                                                                                                               |
| Client hooks/mutations         | `apps/web/src/lib/client/fork/<feature>/`                                   |                                                                                                                                                                               |
| Routes (file-based, TanStack)  | `apps/web/src/routes/**` with a `fork-` filename segment where possible     | Routes must live in the routes tree. `routeTree.gen.ts` is gitignored, so new route files never conflict.                                                                     |
| Tests                          | Colocated `__tests__/` under the fork directories                           |                                                                                                                                                                               |
| Plans / design docs            | `plans/`                                                                    | Never `docs/` (upstream-owned).                                                                                                                                               |

## 3. Database migrations — separate lineage (mandatory)

### 3.1 Why

Upstream migrations are **hand-numbered** (`0283_…` at time of writing) with a **hand-maintained**
`packages/db/drizzle/meta/_journal.json`, and the drizzle-orm migrator tracks only a **high-water
`created_at`**, not a per-file ledger (`packages/db/README.md` "Long-lived dev databases can silently
skip migrations"). A fork migration placed in that sequence would:

1. Conflict with every upstream release on the next free number and the journal tail.
2. Worse: once a fork migration with timestamp _T_ is applied in production, any upstream migration
   merged later whose `when` < _T_ is **silently skipped** on that database.

### 3.2 The rule

- **Never** add files to `packages/db/drizzle/` or entries to its journal. Never edit upstream schema
  files in `packages/db/src/schema/`.
- Fork migrations live in **`packages/db/drizzle-fork/`** with their own `meta/_journal.json`, same
  hand-written-SQL discipline as upstream (`NNNN_<name>.sql`, `idx`/`when` strictly increasing — within
  the fork lineage only).
- They are applied by the stock drizzle migrator with a **separate ledger**:
  `migrate(db, { migrationsFolder: FORK_MIGRATIONS_FOLDER, migrationsTable: '__fork_migrations', migrationsSchema: 'drizzle' })`.
  Because the ledgers are independent, upstream and fork high-water marks never interfere.
- **Ordering:** fork migrations always run **after** upstream migrations in the same `runMigrations()`
  call. Fork DDL may reference upstream tables (FKs), never the reverse.

### 3.3 The seam

One call added at the end of the migrate step in `packages/db/src/migrate-runtime.ts` (`runMigrations`),
marked `// FORK-SEAM(migrations)`. Because `runMigrations()` is the single entry point used by boot
(`packages/db/src/migrate.ts`), the fleet migrator (`apps/web/src/lib/server/fleet/migrator.ts`) and the
drift checker (`packages/db/scripts/check-drift.ts`), one seam covers all three paths. The fork lineage
runs under the same advisory lock the upstream step already holds.

**Pooled-fleet caveat.** The fleet migrator only picks up a workspace whose _upstream_ schema version
is behind target (`fleet/schema-state.ts:121`) and refuses targets beyond the image's own version
(`fleet/migrator.ts:882`). A release that adds **only fork migrations** would therefore never reach
tenant databases through it. Pooled deployments must run an explicit **`fork-migrate`** step after
`fleet-migrator run`: a fork command that iterates every registered workspace (active **and** suspended; see
§3.3a) and applies the fork lineage **then catalogue reconciliation** (idempotent, same advisory lock). It is owned by the provisioner CLI
(`20-control-tower.md`). Single-tenant deployments are unaffected (boot `runMigrations` covers them).

### 3.3a Production rollout of the fork lineage (staff review F1)

Adding a call to `runMigrations` is not sufficient on its own. Foundations must also deliver:

1. **Image contents.** The upstream image copies only `packages/db/drizzle` to `/app/drizzle`
   (`apps/web/Dockerfile:119`) and bundled scripts resolve SQL via `MIGRATIONS_FOLDER`
   (`packages/db/src/schema-version.ts:44-52`). The fork adds a **fork-owned `apps/web/Dockerfile.fork`** layered on
   the upstream image of the same commit (not a seam; upstream's Dockerfile is never edited): it adds
   `/app/drizzle-fork`, sets `FORK_MIGRATIONS_FOLDER`, and ships the bundled fork CLIs (`fork-provision.mjs`, which
   includes `fork-migrate`). The provisioner refuses to run if the folder's journal differs from the one compiled into
   it; a CI image gate asserts both SQL folders and the CLIs are present (`20-control-tower.md` §4.4.1).
2. **Catalogue reconciliation on fork-only releases.** New fork permission keys, Manager exclusions and role-template
   changes live in code and reach a database only when `seedSystemData` runs (`packages/db/src/seed-system.ts:47`).
   `fork-migrate` therefore runs **fork SQL, then `seedSystemData`**, for every tenant, on every release — not SQL only.
3. **Fork schema floor.** The runtime floor (`apps/web/src/lib/server/fleet/schema-floor.ts`) checks only the upstream
   ledger, so a workspace can pass it while missing fork tables. Add `FORK_MIN_SCHEMA_VERSION` checked against
   `drizzle.__fork_migrations` on pool checkout, refusing that workspace (503, same semantics) when below the floor.
   Shared seam **F-11** (first statement of `assertSchemaFloor`; `20-…` §4.4.3).
4. **Suspended tenants.** `fork-migrate` includes suspended tenants where their database is reachable, and
   resuming any tenant must first run `fork-migrate --workspace <key>` (fork SQL + catalogue) and verify both floors,
   failing closed if either fails. The provisioner's `resume` command owns this.
5. **Rehearsals before first production use:** a fork-only permission release; a suspended-then-resumed tenant;
   partial failure mid-fleet (some tenants migrated); previous code running against the new fork schema
   (expand-only discipline applies to fork migrations too).

### 3.4 Drift checking

- Upstream's `db:check-drift` keeps passing unchanged: the scratch DB will now also contain fork tables,
  so add fork tables to the checker's **exemption list via a fork-owned exemption module** imported at
  one seam line, **or** (preferred) scope the upstream diff to upstream schema only — decide during
  implementation of the seam; either way it is one marked line.
- Add a fork-owned `packages/db/scripts/check-fork-drift.ts` that applies both lineages and diffs the
  fork schema (`packages/db/src/fork/schema`) against the live fork tables.
- Add a fork journal-integrity test mirroring `migration-journal-integrity.test.ts`.

### 3.5 Schema design rules for fork tables

- **Do not add columns to upstream tables.** Use a 1:1 **sidecar table** keyed by the upstream PK
  (e.g. `fork_team_tiers(team_id PK → teams.id)`), or a many-to-one table.
- **Workspace config** goes in the fork table `fork_settings(key text PK, value jsonb, updated_at,
updated_by_principal_id)` — **not** new `settings` columns (those require editing `schema/auth.ts`,
  `settings-columns.test.ts`, and the control plane's required-column list).
- **Primary keys:** `uuid` with `defaultRandom()` (or `post_id`-style natural keys for sidecars).
  Do **not** add TypeID prefixes to `packages/ids/src/prefixes.ts` (64 upstream commits / 90 days).
  FKs to upstream entities use the existing `typeIdColumn('<upstream prefix>')` helpers.
- Table names are prefixed **`fork_`** so they are instantly identifiable in SQL, backups and drift
  output.
- Additive only, expand/contract style, so a code version and a schema version one step apart
  coexist during a rolling deploy (same rule as upstream's `schema-version.ts`).
- Any column that acts as a notify claim (`notified_at`-style) must be registered — prefer designs that
  don't need one (derive state from timestamps at read time).

## 4. Seams in upstream files

A **seam** is any edit to an upstream-owned file. Rules:

1. **Every seam is marked** with a comment `FORK-SEAM(<feature>): <one-line why>` on or directly above
   the changed lines (for JSON/Markdown files that can't carry comments, record it in the registry only).
2. **Every seam is registered** in `plans/v2/SEAMS.md` — **the registry is authoritative** for seam IDs and counts,
   and every seam has a named owner and a test that fails if the seam is lost on merge (file, feature, what, how to re-apply) — the
   merge checklist is `grep -rn "FORK-SEAM" apps packages` + that table.
3. **Seams are one-liners where humanly possible:** a mount point (`<ForkSlot name="…" />`), a registry
   call, an import, an enum member. Logic lives in fork directories.
4. **Prefer existing extension points** over seams: the channel registry, the routing
   `registerStrategy`, the integrations capability registry, Labs experiments
   (`lib/shared/labs/registry.ts`) for feature-gating, webhooks, the public REST API and MCP.
5. **Closed unions are seams.** Adding a workflow action, trigger, macro action, view rule, sort key,
   audit event type or activity type is an edit to an upstream union — count it as a seam and minimise
   how many a feature needs.

## 5. Permissions (RBAC catalogue)

- New keys go into `packages/db/src/rbac-catalogue.ts` in **one fenced block per list** at the end of
  `PERMISSIONS`, `PERMISSION_CATALOGUE` and (where decided) `WORKSPACE_ADMIN_PERMISSIONS`:
  `// ── FORK-SEAM(rbac): fork permission keys ── begin/end`.
- **Two-part `noun.verb` keys only** (e.g. `account.execute`, not `support.account.execute`) —
  `scopeForPermission` in `api-key-scopes.ts` reads `split('.')[1]` as the verb.
- **Use existing categories** (e.g. `support`, `feedback`); a new category requires editing the
  exhaustive `CATEGORY_SCOPES` record.
- **Explicit system-role decision per key.** Owner/Admin/Manager are computed as "all keys minus a
  list", so a new key is **auto-granted to Manager** unless added to `WORKSPACE_ADMIN_PERMISSIONS`.
  Each plan must state, per key: Manager? Contributor? admin-only?
- After editing the catalogue: `bun run db:permissions` (regenerates the client mirror
  `apps/web/src/lib/shared/permissions.ts`). The DB side reconciles via `seedSystemData` on migrate.

## 6. Upstream CI guardrails — pass them, don't dodge them

| Guardrail                                                     | What it scans                                                   | Fork rule                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module-state ledger (`policy/module-state/`)                  | `lib/server`, `lib/shared`, `routes/api`, `integrations`, pkgs  | **No module-level mutable state in fork server code** (no top-level `let`, caches, singletons). Per-workspace state goes in the DB or request scope. This is a correctness rule under pooled tenancy, not just a lint. If truly unavoidable, it's a seam in `ledger.ts` + `MODULE-STATE.md`. |
| Authz matrix (`policy/authz-matrix/`, generated `MATRIX.md`)  | every `requireAuth`/`withApiKeyAuth` gate in `apps/web/src`, MCP tools | Every fork server fn gates with `requireAuth({ permission })`. New gates regenerate `MATRIX.md`; non-permission gates are classified via shared seam F-10.                                                                                                                                  |
| Migration contract (generated `CONTRACT.md`)                  | upstream migrations                                             | Unaffected by fork lineage.                                                                                                                                                                                                                                                                    |
| Events contract (`events/CONTRACT.md`)                        | event names `<entity>.<verb>`                                   | Fork events use approved verbs (`created`, `updated`, …) or add a verb deliberately (seam).                                                                                                                                                                                                   |
| Host-vary guard (`__tests__/host-vary.test.ts`)               | public cached routes                                            | Public fork routes use `publicWorkspaceCacheHeaders`.                                                                                                                                                                                                                                          |
| Widget bundle budget (`scripts/check-widget-bundle.ts`)       | portal/widget entry closure                                     | Fork components mounted in `_portal.tsx`/widget stay lean (no Tiptap/ProseMirror).                                                                                                                                                                                                              |
| Portal i18n coverage (`portal-message-coverage.test.ts`)      | 9 `locales/*.json`                                              | Fork UI is English-only (D-N1): prefer rendering fork strings outside upstream's intl catalogue. If a fork string must go through it, add it to all 9 locales (seam, append-only).                                                                                                                                                        |

## 7. Merge procedure (every upstream sync)

1. `git fetch upstream && git merge upstream/main` on a branch `sync/upstream-YYYY-MM-DD`.
2. **Generated files — never hand-merge.** Take upstream's version, then regenerate:
   - `bun run db:permissions` → `apps/web/src/lib/shared/permissions.ts`
   - authz matrix snapshot (`bunx vitest run apps/web/src/lib/server/policy/authz-matrix -u`) → `MATRIX.md`
   - migration contract snapshot → `CONTRACT.md`; module-state snapshot → `MODULE-STATE.md` (if a fork
     ledger entry exists)
   - dependency graph snapshot → `apps/web/src/lib/server/policy/dep-graph/GRAPH.md` (fork modules
     change the import graph)
3. Resolve seam conflicts using `SEAMS.md` (each entry says how to re-apply).
4. `bun run db:check-drift`, fork drift check, `bun run test`, typecheck, lint.
5. Pooled rehearsal (staging): run the fleet migrator, then the workspace isolation probe
   (`apps/web/workspace-probe/`).
6. Update `SEAMS.md` if a seam moved.
7. **Semantic review, not just merge review** (staff review): for every upstream change touching a domain contract
   the fork calls, a role resolver, an assignment writer, an auth flow or an FK target, review it even where no seam
   conflicted — including seam call sites whose callees changed behaviour.
8. After regenerating golden files, run the fork's **negative authorization tests and feature contract tests**; an
   updated snapshot is not proof of safety.
9. Rehearse both an **empty install** and an **upgrade of a populated fork database** (fork-only release,
   old-code/new-schema, suspended tenant, failure recovery).
10. Deployment gates: image contents, both migration ledgers at or above their floors, catalogue seeded, workspace
    isolation probe green.

### 7a. Behavioural contracts to test on every upstream update (second-pass review)

Beyond the repository's own guardrails, run fork contract tests for: legacy-role fallback and `seedSystemData`
healing; MCP token and permission enforcement (incl. the denial check); principal re-point registry coverage;
ticket/conversation assignment and event semantics (incl. the transactional assignment integration); migration
runner and pool-acquisition catch-up behaviour; inbound MIME/signature handling (mail router); auth/provider bootstrap.

**Decisive upgrade rehearsal:** a populated fleet with active **and** suspended tenants, local and tower-owned grants,
pending escalations and account actions, and existing prioritization history. Apply an upstream migration plus
fork/catalogue changes, then resume an old suspended tenant. Validate tenant isolation, grants, data, recovery, and
old-code/new-schema compatibility. Passing only a new empty installation does not establish upgradeability.

Prefer a narrow, documented transactional integration seam over an incorrect two-call design kept only to minimise
changed lines.

## 8. Principal references in fork tables

Upstream merges anonymous principals into identified ones via the re-point registry
(`apps/web/src/lib/server/domains/principals/principal-repoint.ts`), whose completeness test walks
**upstream** schema only — fork tables are invisible to it. Rules:

- Name every principal reference `principal_id` or `*_principal_id` (upstream convention).
- Each fork table with a principal reference declares a merge decision (re-point step or exemption with
  a reason) in a fork registry `apps/web/src/lib/server/fork/principals/fork-repoint.ts`, with a fork
  completeness test over `packages/db/src/fork/schema`.
- Fork steps run via shared seam **F-5** below. Staff-only references (scorer, escalator, requester,
  approver) are normally exemptions; customer references (e.g. `fork_external_account_links`) must
  re-point.

## 9. Feature gating

- Gate each fork feature behind a **Labs experiment** (`lib/shared/labs/registry.ts` — one registry
  line each, a seam) or a `fork_settings` flag, so features can ship dark and be disabled per workspace
  without a deploy.

## 10. Shared foundation seams (owned by Foundations, used by every plan)

To stop each plan adding its own copy of the same upstream edit, these seams are built once in the
Foundations phase and every plan registers into fork-owned lists instead:

| ID  | Upstream file                                                        | Seam                                                                                                   | Fork-owned registry                                             |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| F-1 | `packages/db/src/migrate-runtime.ts`                                 | Apply fork lineage after upstream (§3.3)                                                               | `packages/db/drizzle-fork/`                                     |
| F-2 | `packages/db/scripts/check-drift.ts`                                 | Scope upstream diff to upstream schema / exempt `fork_*` (§3.4)                                        | `packages/db/src/fork/`                                         |
| F-3 | `apps/web/src/lib/server/mcp/tools/index.ts`                         | `registerForkTools(server, auth)` after upstream registration                                          | `mcp/tools/fork-index.ts` → `fork-<feature>.ts`                 |
| F-4 | `apps/web/src/components/admin/settings/settings-modules.ts`         | `return applyForkSettingsModules(modules, flags)` at the end of `buildSettingsModules` (1 upstream commit / 90 days — chosen over `settings-nav.tsx`, 22) | `components/fork/settings/fork-settings-modules.ts` (adds pages to existing modules by id, or a "Workspace extensions" module) |
| F-5 | `apps/web/src/lib/server/domains/principals/principal-repoint.ts`    | Invoke fork re-point steps inside the merge (§8)                                                      | `lib/server/fork/principals/fork-repoint.ts`                    |
| F-6 | `apps/web/src/lib/shared/labs/registry.ts`                           | `...FORK_LABS_EXPERIMENTS` spread in `LABS_REGISTRY`                                                   | `lib/shared/fork/labs.ts`                                       |
| F-7 | `packages/db/src/rbac-catalogue.ts`                                  | One fenced block per list (§5)                                                                         | — (keys live in the block)                                      |
| F-8 | `apps/web/src/lib/server/jobs/definitions.ts`                        | `...FORK_JOB_DEFINITIONS` spread at the end of `JOB_DEFINITIONS`                                        | `lib/server/fork/jobs/definitions.ts`                           |
| F-9 | `apps/web/src/lib/server/audit/log.ts`                               | One fenced block of fork members in the `AuditEventType` union                                         | — (members live in the block; one per feature prefix)           |
| F-10 | `apps/web/src/lib/server/policy/authz-matrix/classifications.ts`  | `...FORK_CLASSIFICATIONS` spread                                                                        | `lib/server/fork/authz/classifications.ts`                      |
| F-11 | `apps/web/src/lib/server/fleet/schema-floor.ts`                      | Also check `FORK_MIN_SCHEMA_VERSION` against the fork ledger (§3.3a)                                     | `packages/db/src/fork/schema-version.ts`                        |
| F-12 | `apps/web/src/lib/server/content/ssrf-guard.ts` (+ webhook write check `events/integrations/webhook/constants.ts`) | Env allow-list `SSRF_ALLOWED_CIDRS` / `SSRF_ALLOWED_HOSTS` for intranet targets; loopback and link-local always blocked (`04-intranet-deployment.md` E-1) | `lib/server/fork/network/allow-list.ts`                         |

Where a v2 plan's seam table lists a settings-nav entry, an MCP registration line, a Labs line or a
catalogue edit, a scheduled job or audit event types, **that entry is satisfied by F-3/F-4/F-6/F-7/F-8/F-9/F-10/F-11/F-12** and is not an additional seam.

## 11. Branding and theming (all fork UI)

Every fork surface an app's users or staff see — the support hub, announcement banners (portal and
embed), account-action panels, tier panels, prioritization panel, settings pages — must **inherit that
app's branding**, so setting it once in the app changes it everywhere (decision D-X1).

- **One source of truth:** upstream's per-app `settings.brandingConfig` (light/dark colours, theme mode,
  font) and `settings.customCss`, compiled by `generateWorkspaceThemeCSS(brandingConfig, visualTheme)`
  (`apps/web/src/lib/shared/theme/generator.ts:505`) into CSS variables, with fonts loaded by
  `PortalBrandingFontLoader` / `readFontSans`. The portal (`routes/_portal.tsx:147-173, 217-260`), its access
  gate and the widget (`routes/widget.tsx:70-121`) already apply it this way.
- **Fork layouts outside `_portal`** (e.g. the hub) must load and inject exactly the same things the portal
  loader does: `themeStyles`, `customCss` (after the theme, so it cascades over it), the font loader, logo,
  favicon and `themeMode` — by calling the same exported upstream helpers, never by copying their output.
- **Style only with theme tokens:** Tailwind semantic classes / CSS variables (`--background`,
  `--foreground`, `--card`, `--primary`, `--primary-foreground`, `--muted`, `--accent`, `--border`,
  `--ring`, `--radius`, `--font-sans`, `--destructive`, `--success`, shadows) and upstream UI primitives
  (`components/ui/*`). **No hard-coded colours, fonts or radii** in fork components. Status colours that the
  theme lacks (e.g. warning, info) are derived from theme tokens (`color-mix(in oklab, var(--…) …)`) in one
  fork token file, so they still shift with the app's palette and dark mode.
- **Dark mode** follows the app's `themeMode` exactly as the portal does.
- **Off-app surfaces** (the embeddable banner on customers' sites) receive the app's generated theme
  variables **and font configuration** with their payload and apply them inside their shadow root. The app's
  `customCss` is **not** applied off-site (it targets portal DOM and could affect the host page); this is a
  deliberate narrowing of the promise for the embed only (see `60-…`).
- The Design-canvas prototype's hard-coded palette is illustrative only; implementation uses tokens.

## 11a. Intranet, no internet egress (D-E1, D-E2)

- **Fork code makes no internet calls.** Every outbound HTTP call from fork code either goes through upstream's SSRF
  guard (`safeFetch` / `checkUrlSafety`, with the F-12 allow-list for intranet hosts) or targets a configured
  intranet or AWS-private (VPC endpoint) service. No SaaS APIs, CDNs, public AI APIs or remote fonts/scripts.
- AI calls go through upstream's OpenAI-compatible clients pointed at the internal proxy (`OPENAI_BASE_URL`), with
  1536-dimension embeddings (`04-intranet-deployment.md` §3).
- Browser assets used by fork UI are bundled or self-hosted (upstream already self-hosts branding fonts).
- Every fork feature must work with the deployment baseline in `04-intranet-deployment.md` (SSO-only, anonymous off,
  telemetry off, IMAP inbound, SMTP outbound).

## 12. Checklist for every fork PR

- [ ] No new files in `packages/db/drizzle/`, no edits to upstream schema files.
- [ ] New tables are `fork_`-prefixed, in `packages/db/src/fork/schema`, with a fork-lineage migration.
- [ ] Every upstream-file edit is marked `FORK-SEAM(...)` and listed in `SEAMS.md`.
- [ ] New permission keys: two-part, fenced block, explicit Manager/Contributor decision recorded.
- [ ] Every server fn gated by `requireAuth({ permission })`; `MATRIX.md` regenerated.
- [ ] No module-level mutable state in fork server code.
- [ ] Works under both `QUACKBACK_TENANCY=single` and `pooled`.
- [ ] No internet egress; intranet targets go through the SSRF guard + F-12 allow-list (§11a).
- [ ] UI uses only theme tokens / upstream UI primitives and inherits the app's branding (§11).
