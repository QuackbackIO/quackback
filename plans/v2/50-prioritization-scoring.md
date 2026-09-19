# Feedback Prioritization Scoring (RICE, BRICE-ready) — v2 Design Plan

> **Status:** v2 (round 2) — supersedes `plans/v1/prioritization-scoring-plan.md`. Planning only; nothing implemented.
> **Depends on:** Foundations (fork lineage F-1/F-2, `fork_settings`, shared seams F-3 MCP / F-4 settings /
> F-5 principal re-point / F-6 Labs / F-7 catalogue) and `10-rbac-persona-extensions.md` (fork catalogue file,
> "UX Team" role template). Build order slot: **after 10, before 30**.
> **Decisions applied:** D1, D2, D3 (✅); D-P5, D-P6, D-P7, D-P8, D-P9 (✅). **Open:** D-P1, D-P2, D-P3, D-P4 (⏳) —
> built on a provisional reading (RICE, Reach = vote count, fixed scales) with extension points so any answer
> lands without rework (§4.2).
> **Goal:** The UX team scores feedback posts that are Under Review with a code-defined framework (RICE first) in
> the admin post modal; Reach is live from votes; the admin inbox can sort by score.

## Round-2 changes

| Change | Driven by |
| --- | --- |
| Scoring is allowed **only** while the post's status is in the configured set (default `['under_review']`); read-only otherwise. Former "strict vs any status" open item removed. | D-P5 ✅ |
| `prioritization.score` held **only** by Owner/Admin (by construction) and the **"UX Team"** role template; excluded from Manager via the fork `WORKSPACE_ADMIN_PERMISSIONS` block. `prioritization.manage` moved to **admin-only** the same way + granted to UX Team. Optional description-reword seam dropped. | D-P6 ✅ |
| Framework (or breaking version) switch: posts in **Open / the default status / Under Review** show **"needs re-scoring"** and sort as unscored; posts in other statuses keep their old score, **labelled with its framework**. Registry now retains retired frameworks/versions. | D-P7 ✅ |
| Separate `post_prioritization.csv` + read-only fork MCP tool confirmed; REST later. | D-P8 ✅ |
| One current score per post + full history confirmed. | D-P9 ✅ |
| D-P1..D-P4 re-opened (⏳): RICE + Reach = `vote_count` kept as provisional; framework interface gained a `reach` source and `derived` factors so the alternatives are registry entries, not redesigns (§4.2.1). | D-P1..D-P4 ⏳ |
| Catalogue (F-7), Labs (F-6) and MCP registration (F-3) are shared seams — removed from this plan's count. Settings page now reachable via F-4 (was a deferred nav seam). Scorer principal columns get a F-5 exemption entry. **Own seams: 10.** | `02-fork-conventions.md` §10, X-R2/X-R3 |
| Fixed §3: the seeded **default** status is `open` (`statuses.ts:45-50`, `isDefault: true`), not `under_review` (`:53-59`). Closed NEW-P9 (import cannot receive the export ZIP). | code verification |

## 0. Changes from v1

| # | v1 issue (review / coordinator finding) | v2 resolution |
| - | --- | --- |
| 1 | Reach was a typed-in factor | Reach derived at read time from `posts.vote_count` (§4.1; provisional pending D-P1/D-P3). Staff type only the manual factors. |
| 2 | Persisted `score real` + `index(score)` — goes stale as votes arrive | **No persisted live score.** Store manual factors; compute in SQL at read/sort time (§4.3). History snapshots score-at-time for audit only. |
| 3 | "custom" user-defined formula evaluator | Dropped. Code-defined, whitelisted registry (RICE now; BRICE slot pending D-P2). |
| 4 | `prioritization.manage` used for scoring, catalogue says "Manage prioritization frameworks" (`rbac-catalogue.ts:407-410`) | New key `prioritization.score` for scoring; `prioritization.manage` (`:81`) = framework config only. Grants per D-P6 (§6). |
| 5 | Keyset row comparison (`post.inbox.ts:234`) would drop NULL scores; cursor lookup had no score branch | `COALESCE(score, -1)` on both sides; cursor score resolved **in SQL** via subselect (§4.4). |
| 6 | `index(score)` | Not possible (derived). PK lookup on `fork_post_prioritization.post_id`; same cost class as the `priority` sort (`post.inbox.ts:199-203`). |
| 7 | Missed sort enum sites | All enumerated as seams (§7). |
| 8 | New props on shared `MetadataSidebar` | One generic slot prop `extraSections?: ReactNode`; only `post-modal.tsx` passes the fork panel. |
| 9 | Extend `PostDetails` / `PostListItem` | Not extended; panel self-fetches. |
| 10 | "Mirror optimistic `useSetPostEta`" | Post-modal uses `setPostEtaFn` + invalidation (`post-modal.tsx:250-260`); fork panel uses its own `useMutation`. |
| 11 | New `prioritization.scored` ActivityType | Skipped (closed union + renderer). History table is the audit trail. |
| 12 | Upstream-schema tables with TypeID prefixes | Fork tables in the fork lineage; no `prefixes.ts` edit. |
| 13 | Config in a new `settings` column | `fork_settings` key `prioritization`. |
| 14 | Server fns in `functions/posts.ts` | `lib/server/fork/prioritization/functions.ts`. |
| 15 | Merge/unmerge undefined | §4.6, no merge-flow seam. |
| 16 | Multi-tenant migrator | Fork lineage via F-1; pooled = migrations before code (§8). |
| 17 | No feature gate | Labs experiment `fork-prioritization` via F-6, default off. |
| 18 | REST/MCP/CSV exposure missing | D-P8: separate CSV + fork MCP read tool (Phase 5); REST later. |
| 19 | `companies.mrrCents` ignored | Extension point for weighted Reach / BRICE "B" (§4.2.1). |
| 20 | Roadmap score ordering | Phase 6, not counted. |

## 1. Requirements

| # | Requirement |
| - | --- |
| R1 | Holders of `prioritization.score` (UX Team role; Owner/Admin by construction) can set/clear a score in the admin post modal. |
| R2 | **D-P5:** editing is allowed only when the post's status slug is in `enabledStatusSlugs` (default `['under_review']`); otherwise the score is read-only. Enforced server-side, not just in the UI. |
| R3 | Reach is derived, not typed (provisional: live vote count). Score updates as votes arrive without re-saving. |
| R4 | Framework is code-defined and whitelisted; RICE ships; BRICE and the D-P1..D-P4 variants plug in as registry entries. |
| R5 | Admin inbox sorts by score (unscored / needs-re-scoring last) with correct keyset pagination; saved views can pin it. |
| R6 | Staff-only: never in portal / widget / public API projections. Every change recorded (D-P9). |
| R7 | **D-P7:** on framework switch, Open/default/Under Review posts need re-scoring; others keep their old score labelled with its framework. |
| R8 | Fork-conventions compliant: fork tables + lineage, minimal marked seams, Labs gate, `single` and `pooled`. |

## 2. TL;DR

- Sidecar `fork_post_prioritization(post_id PK)` holds **manual factors** + framework key/version;
  `fork_post_prioritization_history` is append-only.
- Score is an **SQL expression** from the framework registry over `factors` jsonb × a Reach source, evaluated at
  read time; a TS twin powers the live preview and is parity-tested.
- One slot prop on `MetadataSidebar`; a self-fetching `PrioritizationPanel` from `post-modal.tsx` only.
- New inbox sort key `score`; existing `priority` sort untouched.
- **10 own seams** (Phases 3–5). Catalogue, Labs, MCP registration, settings page and principal re-point ride
  shared F-7/F-6/F-3/F-4/F-5.

## 3. Current state (verified at `780a7b577`)

- `posts.vote_count` — `integer default 0 not null`, `>= 0` (`packages/db/src/schema/posts.ts:68,183`), indexed.
  `+1`/`-1` in `post.voting.ts:283,368`; on merge/unmerge recomputed as unique voters across canonical + merged
  children (`post.merge-ids.ts:103-118`, from `post.merge.ts:163,290,294`). `posts.status_id` → `post_statuses`
  (`posts.ts:55`, indexed `:139`).
- Statuses: seeded `open` is the **default** (`schema/statuses.ts:45-50`, `isDefault: true`); `under_review` at
  `:53-59`. Slugs are unique (`:13`) and editable per workspace; `is_default` column `:18`.
- Inbox: `listInboxPosts` (`post.inbox.ts:211`), `orderByMap[sort]` (`:264-289`); keyset cursor `:217-252`, the
  `priority` branch recomputes the score with a JS round-trip (`:225-235`, `priorityScoreSql` `:199`).
  Merged posts excluded (`:97`).
- `MetadataSidebar` props `:246-317`; ETA block `:543-602`, Board `:604`. Callers: `post-modal.tsx:530`,
  `roadmap-modal.tsx:135`, portal `_portal.b.$slug.posts.$postId.tsx:336`.
- RBAC: `PRIORITIZATION_MANAGE` `rbac-catalogue.ts:81`, entry `:407-410` ("reserved; not yet enforced"; no
  enforcement anywhere in `apps/web/src`). Not in `WORKSPACE_ADMIN_PERMISSIONS` (`:613-641`) ⇒ Manager holds it
  today (`:649` `manager = ALL − WORKSPACE_ADMIN_PERMISSIONS`); Owner = `ALL_PERMISSIONS` (`:645`), Admin =
  all minus `billing.manage` (`:646`). `seedSystemData` reconciles preset bundles **insert missing + delete
  stale** (`seed-system.ts:70-104`) ⇒ adding a key to the admin list revokes Manager's row on next migrate.
  Custom roles: new keys default-off; `createRole` only enforces the editor's grant ceiling
  (`role.service.ts:12-24`, `role.ceiling.ts:22`) — admin-only keys may be placed in a custom role by an admin.
- Labs: `LABS_REGISTRY` (`lib/shared/labs/registry.ts`, via F-6); server read
  `getExperimentStateForWorkspace` (`domains/settings/settings.labs.ts:347`).
- Export: `buildEntityList()` (`domains/export/workspace-export.ts:34-48`, iterated `:57`). Import is
  single-CSV (`domains/import/import-service.ts:421` `parseCSV(data.csvContent)`); no ZIP import path exists
  (only ZIP reader is `domains/assistant/docx-text.ts`).
- Companies: `companies.mrr_cents` (`schema/companies.ts:26`) via `principal.company_id` (`schema/auth.ts:866`).
- Roadmap `sortFor` (`domains/roadmaps/roadmap.query.ts:142-146`): newest/oldest/votes.

## 4. Design

### 4.1 Reach (provisional — D-P1/D-P3 ⏳)

- **Provisional:** `reach = posts.vote_count`. For a canonical post this equals unique voters across itself +
  merged duplicates, so merges raise Reach automatically.
- The alternatives are handled by the Reach-source extension point (§4.2.1), not by schema or seam changes.

### 4.2 Framework registry (code-only)

`apps/web/src/lib/shared/fork/prioritization/frameworks.ts` (client-safe) +
`apps/web/src/lib/server/fork/prioritization/framework-sql.ts` (server):

```ts
type FactorDef =
  | { key: string; source: 'manual'; kind: 'enum'; options: { value: number; label: string }[] }
  | { key: string; source: 'manual'; kind: 'number'; min: number; max?: number; step: number; unit?: string }
  | { key: string; source: 'derived'; from: 'votes' /* | 'reach' */ }   // computed, never stored
interface FrameworkDef {
  key: 'rice' /* | 'brice' | … */
  version: number                         // bump when formula/scales change
  retired?: boolean                       // not selectable; kept to score legacy rows (D-P7)
  compatibleWith?: number[]               // earlier versions whose rows stay current (cosmetic bumps)
  label: string
  reach: 'votes' /* | 'mrr_weighted' | 'none' */
  factors: FactorDef[]
  compute(f: Record<string, number>, ctx: { reach: number; votes: number }): number   // TS twin
}
// server-only, keyed by (key, version):
scoreSql(factors: SQL, ctx: { reach: SQL; votes: SQL }): SQL<number>
```

- **RICE v1 (provisional, D-P4 ⏳):** `impact ∈ {0.25,0.5,1,2,3}`, `confidence ∈ {0.5,0.8,1.0}` (50/80/100 %),
  `effort` person-months `≥ 0.25` step 0.25. `score = reach × impact × confidence / effort`.
  SQL: `(f->>'impact')::float8 * (f->>'confidence')::float8 / NULLIF((f->>'effort')::float8, 0) * reach`.
- Zod input schema generated from manual `factors`; `effort > 0` enforced server-side.
- Registry holds **every (key, version) ever shipped**; only non-retired entries are selectable. Parity test
  `compute()` ≡ `scoreSql()` in Postgres (±1e-9) for every entry.

#### 4.2.1 Extension points for the open decisions

| Open decision | Absorbed by | Rework needed |
| --- | --- | --- |
| **D-P1** Impact derived from votes (instead of / as well as Reach) | A `derived` factor `{ key: 'impact', source: 'derived', from: 'votes' }` whose SQL/TS mapping (e.g. vote-count buckets → 0.25..3) lives in the framework entry; manual `impact` input disappears from the form. | New registry version only. |
| **D-P3** Reach weighted by voter company MRR | `reach: 'mrr_weighted'` — Reach SQL provider `Σ w(companies.mrr_cents)` over `post_votes → principal.company_id`. Fine for the modal; for the inbox sort add a fork cache `fork_post_reach_cache(post_id, weighted_reach)` refreshed by a fork listener on vote/merge events (additive migration). | Registry entry + (for sort perf) one fork table; no upstream seam beyond an existing event hook. |
| **D-P4** Confidence free % / Effort T-shirt sizes | `FactorDef.kind`: `number` 0–100 % for free Confidence; `enum` with numeric values (S=0.5, M=1, L=3, XL=6 months) for T-shirt Effort. | New registry version; old rows follow D-P7. |
| **D-P2** BRICE (weighted sum vs multiplicative, "B" from revenue) | New registry key; "B" is a `manual` enum or a `derived` factor from MRR; formula shape is just `compute`/`scoreSql`. | New registry entry. |

Factors are jsonb and the score is never stored, so none of these touch the tables or seams.

### 4.3 Score at read time (with D-P7)

`scoreForPostSql(postIdSql, voteCountSql, statusIdSql)` returns, with `A` = active `(framework, version)` read
from `fork_settings['prioritization']` (defaults `rice`, latest version) by subselect:

```sql
COALESCE((
  SELECT CASE
    WHEN (fp.framework, fp.framework_version) = A          THEN <A.scoreSql>
    WHEN ps.is_default OR ps.slug = ANY(:rescoreSlugs)     THEN NULL      -- needs re-scoring
    ELSE CASE (fp.framework, fp.framework_version)                         -- legacy, labelled
           WHEN ('rice',1) THEN <rice@1.scoreSql> … END
  END
  FROM fork_post_prioritization fp JOIN post_statuses ps ON ps.id = <statusId>
  WHERE fp.post_id = <postId>
), -1)
```

- **D-P7 rule:** `rescoreSlugs` = `['open', …enabledStatusSlugs]` (default `open`, `under_review`) **plus** any
  status flagged `is_default` (covers workspaces that renamed/replaced `open`). Stored in config, editable.
- A **version bump** that changes formula/scales is treated exactly like a framework switch; a cosmetic bump
  (label only) keeps `compatibleWith` so rows stay current.
- `-1` sentinel ⇒ unscored and needs-re-scoring sort after every scored post (real scores `≥ 0`).
- Legacy scores from other frameworks sort **numerically alongside** current ones; the UI labels them
  (e.g. "12.4 · RICE v1"). Cross-framework comparability is the owner's accepted trade-off under D-P7.
- Per-DB config subselect ⇒ no module state; correct under pooled tenancy.
- **Perf:** one PK lookup + one status PK join per candidate post. Gate (Phase 4): `EXPLAIN ANALYZE` on 10k posts,
  p95 ≤ existing `priority` sort + 20 %.

### 4.4 Inbox sort key `score` + keyset pagination

In `post.inbox.ts` (two marked hunks) delegating to `lib/server/fork/prioritization/inbox-sort.ts`:

- `orderByMap.score` → `[desc(scoreForPostSql(posts.id, posts.voteCount, posts.statusId)), desc(posts.createdAt), desc(posts.id)]`.
- Cursor branch next to `sort === 'priority'`:
  ```sql
  (S(posts.*), posts.created_at, posts.id)
    < ((SELECT S(p2.*) FROM posts p2 WHERE p2.id = $cursor), $cursorDate, $cursorUuid::uuid)
  ```
  COALESCEd on both sides; no JS float round-trip.
- Known limitation (same as `votes`/`priority`): a vote or status change between pages can move a post across the
  cursor. Accepted.
- Optional Phase 4b: score chip in the row (+1 seam, off by default).

### 4.5 Post modal panel

- `MetadataSidebar`: `extraSections?: ReactNode` between ETA (`:602`) and Board (`:604`); other callers unchanged.
- `post-modal.tsx:530`: `extraSections={<PrioritizationPanel postId={postId} statusId={currentStatus?.id} voteCount={post.voteCount} />}`.
- `components/fork/prioritization/prioritization-panel.tsx`:
  - Query `['fork','prioritization',postId,statusId]` → `getPostPrioritizationFn` returning
    `{ enabled, editable, state: 'unscored'|'current'|'needs_rescore'|'legacy', framework, frameworkLabel, factors|null, reach, score|null, scoredBy, scoredAt, note, history[≤20] }`.
  - Hidden when lab off or caller lacks `post.view_private`.
  - Editable form only when `editable` = status slug ∈ `enabledStatusSlugs` **and** caller holds
    `prioritization.score`. Otherwise read-only: score + framework label, "last scored by X on D", history.
    Non-Under-Review posts show "Scoring opens when the post is Under Review" to key holders.
  - `needs_rescore`: badge "Needs re-scoring (was 12.4 · RICE v1)"; form pre-filled from old factors where the
    new framework shares the factor key.
  - Mutations via `useMutation` (`lib/client/fork/prioritization/`), invalidate panel key + `inboxKeys.lists()`.
  - If no configured slug matches a live status, `prioritization.manage` holders see a settings hint.

### 4.6 Merge / unmerge / delete

- **Merge:** duplicate's row untouched (hidden with the duplicate); canonical keeps its own factors; its Reach
  rises via recomputed `vote_count`. Panel hint "N merged posts carry their own scores".
- **Unmerge:** duplicate's row live again; both Reach values follow recomputed counts.
- **Soft delete:** row retained. **Hard delete:** `ON DELETE CASCADE`.
- No merge-flow seam.

### 4.7 Server functions & services

`apps/web/src/lib/server/fork/prioritization/`:

| Function | Gate | Behaviour |
| --- | --- | --- |
| `getPostPrioritizationFn({ postId })` | `post.view_private` + lab | Row + state + score + editable + last 20 history rows |
| `setPostPrioritizationFn({ postId, factors, note? })` | `prioritization.score` + lab + **status ∈ `enabledStatusSlugs`** (read inside the transaction, `ForbiddenError` otherwise) | Validate against the **active** framework, upsert row, append history with `reach_at_time` + `score_at_time`, one transaction |
| `clearPostPrioritizationFn({ postId })` | `prioritization.score` + lab + same status gate | Delete row, append `action='cleared'` |
| `getPrioritizationConfigFn()` | `post.view_private` | `{ enabled, framework, version, enabledStatusSlugs, rescoreStatusSlugs }` |
| `updatePrioritizationConfigFn(cfg)` | `prioritization.manage` + lab | Upsert config; framework must be a non-retired registry key; switching framework is a config write only (no row rewrites — D-P7 is evaluated at read time) |

- Actor-parameterised services; no module-level state.
- Lab off ⇒ reads `{ enabled: false }`, writes `ForbiddenError`.
- All gates `requireAuth({ permission })` ⇒ regenerate `MATRIX.md`; no `classifications.ts` entry.
- No events/webhooks in v1.

### 4.8 Settings UI

Fork page `components/fork/settings/prioritization-settings.tsx`, registered into the settings modules via
**F-4** (`fork-settings-modules.ts`), visible when lab on and user holds `prioritization.manage`: framework
picker (non-retired entries), scoring statuses (multi-select, default Under Review), re-score statuses
(default Open + default status + scoring statuses), read-only "Reach = votes" explanation, and a framework-switch
confirmation showing how many posts will become "needs re-scoring".

### 4.9 Exposure (D-P8)

- **CSV (Phase 5):** `post_prioritization.csv`
  (`post_id,framework,framework_version,state,impact,confidence,effort,reach,score,scored_by,scored_at`) via one
  line in `buildEntityList()`. `posts.csv` untouched. Reach/score/state computed at export time. The ZIP is
  export-only (import is single-CSV, §3), so the extra file cannot break import.
- **MCP (Phase 5):** `get_post_prioritization` in `mcp/tools/fork-prioritization.ts` (read-only, `post.view_private`,
  team-only), listed in the F-3 fork aggregator.
- **REST:** later.

## 5. Data model (fork lineage)

`packages/db/src/fork/schema/prioritization.ts`; migration `packages/db/drizzle-fork/NNNN_post_prioritization.sql`.

`fork_post_prioritization` (current score, 1:1 — D-P9):

| Column | Type | Notes |
| --- | --- | --- |
| `post_id` | `typeIdColumn('post')` **PK** | FK → `posts.id` `ON DELETE CASCADE` |
| `framework` | text not null | registry key |
| `framework_version` | int not null | registry version at save |
| `factors` | jsonb not null | manual factors only |
| `note` | text null | |
| `scored_by_principal_id` | `typeIdColumnNullable('principal')` | FK `ON DELETE SET NULL` |
| `scored_at` | timestamptz not null | |
| `created_at` / `updated_at` | timestamptz not null default now() | |

`fork_post_prioritization_history` (append-only, D-P9): `id` uuid PK; `post_id` (FK cascade); `action`
(`set`|`cleared`); `framework`, `framework_version`, `factors` (nullable for `cleared`); `reach_at_time` int;
`score_at_time` double precision (audit only); `note`; `scored_by_principal_id` (FK `SET NULL`); `created_at`.
Index `(post_id, created_at desc)`.

`fork_settings['prioritization']` =
`{ "framework": "rice", "version": 1, "enabledStatusSlugs": ["under_review"], "rescoreStatusSlugs": ["open", "under_review"] }`
(zod in `lib/shared/fork/prioritization/config.ts`; missing ⇒ defaults; `is_default` status always added at read).

- **Principal re-point (F-5):** both `scored_by_principal_id` columns registered in `fork-repoint.ts` as
  **exemptions** (staff-only scorer; anonymous principals never score).
- Additive only; fork drift check + journal-integrity test cover both tables.

## 6. Permissions (D-P6)

| Key | Status | Owner / Admin | Manager | Contributor | UX Team template | Enforced in |
| --- | --- | --- | --- | --- | --- | --- |
| `prioritization.score` | **new**, category `feedback` | ✅ (by construction: `ALL_PERMISSIONS`) | ❌ (in fork admin block) | ❌ | ✅ | set/clear fns, panel edit affordance |
| `prioritization.manage` | existing reserved (`:81`) | ✅ (by construction) | ❌ (**moved** to fork admin block) | ❌ | ✅ | config fn, settings page |
| `post.view_private` | existing | ✅ | ✅ | ✅ | ✅ (template needs it to see the panel) | read fns, panel, MCP tool |

- **Mechanism (verified):** both keys go in the fork list spread into `WORKSPACE_ADMIN_PERMISSIONS` (plan 10's
  `FORK_WORKSPACE_ADMIN_PERMISSIONS`, F-7). Manager = `ALL − WORKSPACE_ADMIN_PERMISSIONS` (`rbac-catalogue.ts:649`),
  so neither key reaches Manager; Owner/Admin derive from `ALL_PERMISSIONS` (`:645-646`) and **always hold every
  key** — the owner's "only UX scores" therefore means "only UX Team among non-admin roles". On the next migrate
  `seedSystemData` deletes Manager's existing `prioritization.manage` row (`seed-system.ts:100-103`). The fork file
  references `'prioritization.manage'` as a typed string literal (no value import from the catalogue ⇒ no cycle).
  Since nothing enforces the key upstream today (§3), revoking it from Manager has no upstream side effect.
- UX Team role: custom role from plan 10's template installer; keys granted explicitly (`createRole` ceiling —
  installer must be Owner/Admin, who hold both keys). Existing installs get the keys via `syncPersonaTemplateFn`.
- `scopeForPermission` (`api-key-scopes.ts:247-254`) maps `score`/`manage` → `feedback` write; no scope-map edit.
- Upstream description still reads "(reserved; not yet enforced)"; tolerated (no seam — cosmetic, shown only in the
  role editor). `bun run db:permissions` after editing.

## 7. Seams (own)

| # | Upstream file | Change | Why | Re-apply |
| - | --- | --- | --- | --- |
| P-1 | `apps/web/src/lib/shared/types/filters.ts:28` | `\| 'score'` on `InboxFilters.sort` | Closed sort union | Re-add member |
| P-2 | `apps/web/src/lib/server/domains/posts/post.types.ts:146` | `\| 'score'` on `InboxPostListParams.sort` | Closed sort union | Re-add member |
| P-3 | `apps/web/src/lib/server/functions/posts.ts:94` | `'score'` in `listInboxPostsSchema` | Server validation | Re-add enum value |
| P-4 | `apps/web/src/lib/shared/post/views.ts:22` | `'score'` in `POST_VIEW_SORTS` | Saved views pin sorts | Re-add value |
| P-5 | `apps/web/src/routes/admin/feedback.tsx:20` | `'score'` in route search enum | `.catch(undefined)` drops unknown sorts | Re-add value |
| P-6 | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx:144-149` | Spread `...useForkPrioritizationSortOptions()` | Literal option list | Re-add hook + spread |
| P-7 | `apps/web/src/lib/server/domains/posts/post.inbox.ts` | `score` in `orderByMap` + cursor branch → fork `inbox-sort.ts` | Inline sort/keyset logic | Re-add two marked hunks |
| P-8 | `apps/web/src/components/public/post-detail/metadata-sidebar.tsx` | `extraSections?: ReactNode` slot | No slot; shared with portal | Re-add prop + render line |
| P-9 | `apps/web/src/components/admin/feedback/post-modal.tsx` | Pass `<PrioritizationPanel/>` into slot | Only admin mount point | Re-add prop |
| P-10 | `apps/web/src/lib/server/domains/export/workspace-export.ts` | Fork exporter in `buildEntityList()` (Phase 5) | Closed entity list | Re-add import + entry |

**Own count: 10** (P-1..P-9 Phases 3–4, P-10 Phase 5). **Via shared seams (not counted):** F-7 catalogue keys +
admin-block entries; F-6 Labs entry; F-3 MCP tool; F-4 settings page; F-5 re-point exemptions.
**Deferred:** roadmap `sortFor` + roadmap enums (Phase 6), row score chip (4b, +1).

## 8. Phases & validation gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0. Prereqs** | Foundations (F-1..F-7, `fork_settings`); plan 10 fork catalogue file + UX Team template | Merged; fork drift green |
| **1. Schema + registry** | Fork tables; `frameworks.ts` (RICE v1), `framework-sql.ts`, config; Labs entry (F-6); keys in fork block + admin block (F-7); UX Team template keys; re-point exemptions (F-5) | Unit: RICE math, validation. DB: TS/SQL parity over every registry entry. `seedSystemData`: Manager lacks both keys, Owner/Admin hold both. **Pooled:** fork lineage applied fleet-wide before dependent code. |
| **2. Backend** | Services + 5 fns | Integration: set as UX Team ✅ / Admin ✅ / Manager ❌ / Contributor ❌; set on Under Review ✅, on Open/Planned ❌ (server-side); config as Manager ❌, UX Team ✅; history rows; lab-off forbidden. `MATRIX.md` regenerated. |
| **3. Post-modal panel** | P-8, P-9; panel | Portal + roadmap modal unchanged (snapshot). Manual: Under Review → score → vote on portal → score rose; move to Planned → read-only. |
| **4. Inbox sort** | P-1..P-7 | Keyset: 3 pages over scored / unscored / zero-vote / needs-re-scoring / legacy posts, no dup/skip, sentinel rows last. `EXPLAIN ANALYZE` in budget. `priority` sort regression. Saved view round-trip. |
| **5. Settings + exposure** | Settings page (F-4); CSV (P-10); MCP tool (F-3) | Framework switch: Open/Under Review/default-status posts → "needs re-scoring", Planned/Complete keep labelled legacy score; ZIP has `post_prioritization.csv`, `posts.csv` byte-identical; MCP denied without `post.view_private`. |
| **6. Later** | D-P1..D-P4 variants / BRICE as registry entries; MRR reach cache; roadmap sort; row chip; REST | Per item |

Rollback: disable the lab. Code rollback leaves fork tables (additive); reset pinned views with
`UPDATE post_views SET filters = filters - 'sort' WHERE filters->>'sort' = 'score'`. Reverting D-P6 is a fork-block
edit + migrate (reconcile restores Manager rows).

## 9. Testing strategy

- **Unit:** per-entry `compute()`, factor-schema generation (enum/number/derived), config defaults, sentinel and
  state classification (`current` / `needs_rescore` / `legacy`).
- **DB integration:** SQL/TS parity; upsert + history atomicity; server-side status gate; merge/unmerge Reach;
  cascade; framework switch and breaking version bump per D-P7 across all seeded statuses, including a renamed
  default status.
- **Inbox:** keyset suite modelled on `priority`/`votes`; filters combined with `score`; facet counts unaffected.
- **Authz:** matrix snapshot; Manager and Contributor denied score + manage; UX Team custom role allowed on
  dashboard, REST and MCP (plan 10 D3 enforcement).
- **Isolation:** no fork fields in portal/widget/public API; pooled probe after fleet migration.
- **Regression:** `priority` sort, ETA editor, portal sidebar, upstream `posts.csv` tests.

## 10. Open items

| Ref | Item |
| --- | --- |
| D-P1 ⏳ | Reach = vote count (provisional) vs Impact derived from votes. Either lands as a registry entry (§4.2.1). |
| D-P2 ⏳ | BRICE formula, scales, weighted vs multiplicative, whether "B" uses company revenue. |
| D-P3 ⏳ | Reach weighted by voter company MRR vs raw count. Weighted needs the fork reach cache for inbox sort. |
| D-P4 ⏳ | Confidence fixed 50/80/100 % (provisional) vs free %; Effort person-months (provisional) vs T-shirt sizes. |
| NEW-P10 | D-P7 consequence: legacy scores from a previous framework sort numerically next to current-framework scores. Accept, or sort legacy rows after current ones? (Proposed: accept, labelled.) |

## 11. Relationship to other v2 plans

- **Foundations / `02-fork-conventions.md`:** fork lineage, `fork_settings`, F-3/F-4/F-5/F-6/F-7, `SEAMS.md`
  (rows P-1..P-10 unchanged in number; P-1..5 grouped there).
- **10-rbac-persona-extensions.md:** owns the fork catalogue file and templates. **Needs updating to match D-P6:**
  its §6 table still shows Manager ✓ for both prioritization keys and `prioritization.manage` "(already)"; its
  Phase 1 gate says Manager "holds `prioritization.score`"; and it lists UX as an unseeded recipe rather than the
  **"UX Team"** template. Required: both keys in `FORK_WORKSPACE_ADMIN_PERMISSIONS`; UX Team template with
  `prioritization.score`, `prioritization.manage`, `post.view_private` (+ its other feedback reads).
- **30 / 40:** independent.
- **20-control-tower.md:** later read-only rollup of top-scored posts via the Phase 5 MCP tool with the admin's own
  token (D-C2).
- **60-announcements-banner.md:** none.
