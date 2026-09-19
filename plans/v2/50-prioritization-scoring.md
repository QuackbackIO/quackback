# Feedback Prioritization Scoring (RICE, BRICE-ready) — v2 Design Plan

> **Status:** v2 (round 2 + staff review) — supersedes `plans/v1/prioritization-scoring-plan.md`. Planning only; nothing implemented.
> **Depends on:** Foundations (fork lineage F-1/F-2, `fork_settings`, shared seams F-3 MCP / F-4 settings /
> F-5 principal re-point / F-6 Labs / F-7 catalogue / F-8 jobs) and `10-rbac-persona-extensions.md` (fork catalogue
> file, "UX Team" role template, per-tool MCP permission gate R-5). Build order slot: **after 10, before 30**.
> **Decisions applied:** D1, D2, D3 (✅); D-P5, D-P6, D-P7, D-P8, D-P9 (✅). **Open:** D-P1, D-P2, D-P3, D-P4 (⏳);
> O-P10, O-P11, O-P12 (🟡, defaults adopted). Built on a provisional reading (RICE, Reach = vote count, fixed
> scales). The extension points in §4.2.1 are meant to keep each answer small, but some answers (notably
> weighted Reach) need new tables, a job and their own tests — see the estimates there.
> **Goal:** The UX team scores feedback posts that are Under Review with a code-defined framework (RICE first) in
> the admin post modal; Reach is live from votes; the admin inbox can sort by score and shows each row's score and
> framework; the control tower reads a paginated portfolio via MCP.

## Round-2 changes

| Change | Driven by |
| --- | --- |
| Scoring is allowed **only** while the post's status is in the configured set (default `['under_review']`); read-only otherwise. Former "strict vs any status" open item removed. | D-P5 ✅ |
| `prioritization.score` held **only** by Owner/Admin (by construction) and the **"UX Team"** role template; excluded from Manager via the fork `WORKSPACE_ADMIN_PERMISSIONS` block. `prioritization.manage` moved to **admin-only** the same way + granted to UX Team. Optional description-reword seam dropped. | D-P6 ✅ |
| Framework (or breaking version) switch: posts in **Open / the default status / Under Review** need re-scoring and sort as unscored; posts in other statuses keep their old score, **labelled with its framework**. Registry retains retired frameworks/versions. (Mechanics revised by the staff review — §4.3.) | D-P7 ✅ |
| Separate `post_prioritization.csv` + read-only fork MCP tool confirmed; REST later. | D-P8 ✅ |
| One current score per post + full history confirmed. | D-P9 ✅ |
| D-P1..D-P4 re-opened (⏳): RICE + Reach = `vote_count` kept as provisional; framework interface gained a `reach` source and `derived` factors (§4.2.1). | D-P1..D-P4 ⏳ |
| Catalogue (F-7), Labs (F-6) and MCP registration (F-3) are shared seams — not counted here. Settings page reachable via F-4. Scorer principal columns get an F-5 exemption entry. | `02-fork-conventions.md` §10, X-R2/X-R3 |
| Fixed §3: the seeded **default** status is `open` (`statuses.ts:45-50`, `isDefault: true`), not `under_review` (`:53-59`). Closed NEW-P9 (import cannot receive the export ZIP). | code verification |

## Staff-review changes

| Finding ID | Change | Where in plan |
| --- | --- | --- |
| P1 (invalidation) | **Switch-time invalidation** replaces read-time status evaluation. The switch transaction persists `needs_rescore = true` on rows whose post is in a re-score status **at that moment**; later status moves do not flip it. Cleared only by re-scoring (a save), or by a later switch that makes the row's version current again. The sort SQL no longer joins `post_statuses`. Default adopted; owner question O-P11 🟡. | §4.3, §4.7, §5, O-P11 |
| P1 (legacy value) | **Legacy scores are frozen**, not recomputed: the switch transaction writes `frozen_score` / `frozen_reach` / `frozen_at`, computed with the outgoing formula and the Reach at that moment. Removes the old read-time "recompute with retired formula + live votes" branch. Default adopted; owner question O-P12 🟡. | §4.3, §5, O-P12 |
| P1 (`compatibleWith`) | The score SQL now implements the compatible-version branch: the row is current iff `framework = A.key AND framework_version = ANY(A.version ∪ A.compatibleWith)`. The active config is read in TS once per request, so the active entry's `scoreSql` and compatible set are chosen in code (the old SQL-subselect CASE is gone). Registry test: compatible versions have identical factor schemas and `compute`. | §4.2, §4.3, §9 |
| P1 (mixed ordering) | Contradiction removed ("accepted" in §4.3 vs open NEW-P10). Default: **current-framework scores first, frozen legacy scores after, then needs-re-scoring / unscored.** Implemented as a `(tier, value)` sort key used by ORDER BY and the keyset cursor. Owner question O-P10 🟡 (default changed from "accept" to "legacy after current"). | §4.3, §4.4, O-P10 |
| P1 (stale-form save) | Saves send `expectedFramework` + `expectedVersion`. The set/clear transaction takes a shared advisory lock on the workspace's prioritization config (a switch takes it exclusively), re-reads config and **locks the post row** (`FOR SHARE`) to check status; a mismatch returns `ConflictError('PRIORITIZATION_CONFIG_CHANGED')` and the panel reloads. A stale form cannot save under a changed formula or a status that has since left the scoring set. | §4.5, §4.7, §9 |
| P1 (portfolio MCP) | New batch tool **`list_post_prioritization`** (filters, keyset pagination, same ordering as the inbox `score` sort), gated `post.view_private` + lab, team principals only. Returns post id, title, status, score, state, framework/version, `needsRescore`, Reach and its as-of time. This is the tower portfolio contract (§4.9.1); `get_details` is not relied on. | §4.9.1, §8 Phase 5, §9 |
| P1 (revenue cache) | If D-P3 selects weighted Reach: company counting / dedup rules defined; cache contract covers MRR edits, company attach/detach/delete, identity merges, votes, merges and imports. Upstream emits no event for MRR edits or company reassignment (`company.service.ts:110-140`, `:503-516`), so the cache is **rebuilt by a scheduled fork job (F-8)**, not event-maintained; all surfaces read the same source and show `reachAsOf`. Live aggregate tried first; cache only if the perf gate fails. | §4.2.1, §4.10, §9 |
| P1 (wording) | "Registry entry only / no rework" wording softened to estimates; weighted Reach and frozen scores are acknowledged as table/job work. | header, R4, §4.2.1 |
| X-5 | **Row score chip ships in Phase 4 with the sort** (was optional 4b). The chip shows value + framework label (current / legacy "· RICE v1 · frozen" / "Needs re-scoring"), fetched in one batched call per list page; no change to the upstream list DTO. New seam **P-11**. | §4.4, §7, §8 |
| X-6 | Removed the §11 note asking plan 10 to change its tables; §11 now states only this plan's contracts. Seam IDs match `SEAMS.md` (P-1..P-10) + new P-11. | §7, §11 |
| X-7 | Phase 6 labelled **not delivering** D-P1..D-P4 variants, BRICE or roadmap ordering; Phases 0–5 deliver RICE on provisional scales only. | §8 |

## 0. Changes from v1

| # | v1 issue (review / coordinator finding) | v2 resolution |
| - | --- | --- |
| 1 | Reach was a typed-in factor | Reach derived at read time from `posts.vote_count` (§4.1; provisional pending D-P1/D-P3). Staff type only the manual factors. |
| 2 | Persisted `score real` + `index(score)` — goes stale as votes arrive | **No persisted live score.** Store manual factors; compute in SQL at read/sort time (§4.3). Only legacy rows carry a frozen score (by design). History snapshots score-at-time for audit. |
| 3 | "custom" user-defined formula evaluator | Dropped. Code-defined, whitelisted registry (RICE now; BRICE slot pending D-P2). |
| 4 | `prioritization.manage` used for scoring, catalogue says "Manage prioritization frameworks" (`rbac-catalogue.ts:407-410`) | New key `prioritization.score` for scoring; `prioritization.manage` (`:81`) = framework config only. Grants per D-P6 (§6). |
| 5 | Keyset row comparison (`post.inbox.ts:234`) would drop NULL scores; cursor lookup had no score branch | `COALESCE` on both sides; cursor `(tier, value)` resolved **in SQL** via subselect (§4.4). |
| 6 | `index(score)` | Not possible (derived). PK lookup on `fork_post_prioritization.post_id`; same cost class as the `priority` sort (`post.inbox.ts:199-203`). |
| 7 | Missed sort enum sites | All enumerated as seams (§7). |
| 8 | New props on shared `MetadataSidebar` | One generic slot prop `extraSections?: ReactNode`; only `post-modal.tsx` passes the fork panel. |
| 9 | Extend `PostDetails` / `PostListItem` | Not extended; panel self-fetches, row chip batch-fetches per page (§4.4). |
| 10 | "Mirror optimistic `useSetPostEta`" | Post-modal uses `setPostEtaFn` + invalidation (`post-modal.tsx:250-260`); fork panel uses its own `useMutation`. |
| 11 | New `prioritization.scored` ActivityType | Skipped (closed union + renderer). History table is the audit trail. |
| 12 | Upstream-schema tables with TypeID prefixes | Fork tables in the fork lineage; no `prefixes.ts` edit. |
| 13 | Config in a new `settings` column | `fork_settings` key `prioritization`. |
| 14 | Server fns in `functions/posts.ts` | `lib/server/fork/prioritization/functions.ts`. |
| 15 | Merge/unmerge undefined | §4.6, no merge-flow seam. |
| 16 | Multi-tenant migrator | Fork lineage via F-1; pooled = migrations before code (§8). |
| 17 | No feature gate | Labs experiment `fork-prioritization` via F-6, default off. |
| 18 | REST/MCP/CSV exposure missing | D-P8: separate CSV + fork MCP read tools (Phase 5); REST later. |
| 19 | `companies.mrrCents` ignored | Weighted-Reach extension (§4.2.1, §4.10). |
| 20 | Roadmap score ordering | Phase 6 (not delivered by this plan's core phases). |

## 1. Requirements

| # | Requirement |
| - | --- |
| R1 | Holders of `prioritization.score` (UX Team role; Owner/Admin by construction) can set/clear a score in the admin post modal. |
| R2 | **D-P5:** editing is allowed only when the post's status slug is in `enabledStatusSlugs` (default `['under_review']`); otherwise the score is read-only. Enforced server-side inside the save transaction, not just in the UI. |
| R3 | Reach is derived, not typed (provisional: live vote count). Current-framework scores update as votes arrive without re-saving. |
| R4 | Framework is code-defined and whitelisted; RICE ships. BRICE and the D-P1..D-P4 variants are added as new registry entries/versions; some need extra storage or jobs (§4.2.1). |
| R5 | Admin inbox sorts by score (current → legacy → needs-re-scoring/unscored) with correct keyset pagination; saved views can pin it; each row shows score + framework label. |
| R6 | Staff-only: never in portal / widget / public API projections. Every change recorded (D-P9). |
| R7 | **D-P7:** on framework switch, posts in Open/default/Under Review **at switch time** need re-scoring; others keep their (frozen) old score labelled with its framework. |
| R8 | A save is rejected if the framework/version or the post status changed since the form loaded. |
| R9 | The control tower can list prioritization for a workspace in pages via one MCP tool with the same ordering and values as the app. |
| R10 | Fork-conventions compliant: fork tables + lineage, marked seams, Labs gate, `single` and `pooled`. |

## 2. TL;DR

- Sidecar `fork_post_prioritization(post_id PK)` holds **manual factors**, framework key/version, a persisted
  `needs_rescore` marker and frozen legacy values; `fork_post_prioritization_history` is append-only.
- Current score is an **SQL expression** from the active registry entry over `factors` jsonb × a Reach source,
  evaluated at read time; a TS twin powers the live preview and is parity-tested. Legacy scores are frozen at switch.
- Sort key `(tier, value)`: current, then legacy, then needs-re-scoring/unscored.
- One slot prop on `MetadataSidebar`; a self-fetching `PrioritizationPanel` from `post-modal.tsx` only; a batched
  score chip on inbox rows.
- MCP: `get_post_prioritization` (one post) + `list_post_prioritization` (portfolio page).
- **11 own seams** (Phases 3–5). Catalogue, Labs, MCP registration, settings page, principal re-point and the
  optional reach job ride shared F-7/F-6/F-3/F-4/F-5/F-8.

## 3. Current state (verified at `780a7b577`; new claims re-checked at `eb7914767`)

- `posts.vote_count` — `integer default 0 not null`, `>= 0` (`packages/db/src/schema/posts.ts:68,183`), indexed.
  `+1`/`-1` in `post.voting.ts:283,368`; on merge/unmerge recomputed as unique voters across canonical + merged
  children (`post.merge-ids.ts:103-118`, from `post.merge.ts:163,290,294`). `posts.status_id` → `post_statuses`
  (`posts.ts:55`, indexed `:139`). `post_votes` unique `(post_id, principal_id)` (`posts.ts:241`).
- Statuses: seeded `open` is the **default** (`schema/statuses.ts:45-50`, `isDefault: true`); `under_review` at
  `:53-59`. Slugs are unique (`:13`) and editable per workspace; `is_default` column `:18`.
- Inbox: `listInboxPosts` (`post.inbox.ts:211`), keyset cursor `:217-252`, `orderByMap` `:257-262`; the
  `priority` branch recomputes the score with a JS round-trip (`:225-235`, `priorityScoreSql` `:199`).
  Merged posts excluded (`:97`).
- Inbox list: `feedback-table-view.tsx` literal `sortOptions` `:144-149`; rows rendered `:236-248` as
  `<FeedbackRow post statuses duplicateCount onClick/>` — the per-row `duplicateCountByPostId` map is the
  precedent for a batched per-page overlay. `FeedbackRow` (`feedback-row.tsx`) takes `PostListItem`, no slot.
- `MetadataSidebar` props `:246-317`; ETA block `:543-602`, Board `:604`. Callers: `post-modal.tsx:530`,
  `roadmap-modal.tsx:135`, portal `_portal.b.$slug.posts.$postId.tsx:336`.
- RBAC: `PRIORITIZATION_MANAGE` `rbac-catalogue.ts:81`, entry `:407-410` ("reserved; not yet enforced"; no
  enforcement anywhere in `apps/web/src`). Not in `WORKSPACE_ADMIN_PERMISSIONS` (`:613-641`) ⇒ Manager holds it
  today (`:649` `manager = ALL − WORKSPACE_ADMIN_PERMISSIONS`); Owner = `ALL_PERMISSIONS` (`:645`), Admin =
  all minus `billing.manage` (`:646`). `seedSystemData` reconciles preset bundles **insert missing + delete
  stale** (`seed-system.ts:70-104`) ⇒ adding a key to the admin list revokes Manager's row on next migrate.
  Custom roles: new keys default-off; `createRole` only enforces the editor's grant ceiling
  (`role.service.ts:12-24`, `role.ceiling.ts:22`).
- Labs: `LABS_REGISTRY` (`lib/shared/labs/registry.ts`, via F-6); server read
  `getExperimentStateForWorkspace` (`domains/settings/settings.labs.ts:347`).
- Export: `buildEntityList()` (`domains/export/workspace-export.ts:34-48`, iterated `:57`). Import is
  single-CSV (`domains/import/import-service.ts:421`); no ZIP import path exists.
- Companies: `companies.mrr_cents` (`schema/companies.ts:26`) via `principal.company_id` (`schema/auth.ts:866`,
  FK `ON DELETE SET NULL`). `updateCompany` (`company.service.ts:110-140`) changes MRR **without emitting any
  event**; `attachPrincipal` / `detachPrincipal` (`:503-516`) reassign companies **without events**; only
  `company.created` / `company.deleted` exist (`events/catalogue/crm.ts:11-12`). Identity merge re-points
  `post_votes` (`principal-repoint.ts:219`).
- `ConflictError` exists (`lib/shared/errors.ts:76`).
- Roadmap `sortFor` (`domains/roadmaps/roadmap.query.ts:142-146`): newest/oldest/votes.

## 4. Design

### 4.1 Reach (provisional — D-P1/D-P3 ⏳)

- **Provisional:** `reach = posts.vote_count`. For a canonical post this equals unique voters across itself +
  merged duplicates, so merges raise Reach automatically.
- Weighted Reach (if chosen) follows §4.10.

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
  retired?: boolean                       // not selectable; kept for labels, CSV, history display
  compatibleWith?: number[]               // earlier versions of the same key whose rows stay current
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
  `compute()` ≡ `scoreSql()` in Postgres (±1e-9) for every entry. `compatibleWith` entries must have identical
  manual factor schemas and identical `compute` over a fixture grid (unit test) — otherwise the bump is breaking.
- `activeSet(A) = { (A.key, v) : v ∈ {A.version} ∪ A.compatibleWith }`, computed in TS.

#### 4.2.1 Extension points for the open decisions

Estimates, not guarantees — each answer still needs its own tests and a version bump that triggers D-P7.

| Open decision | Absorbed by | Expected work |
| --- | --- | --- |
| **D-P1** Impact derived from votes | A `derived` factor `{ key: 'impact', source: 'derived', from: 'votes' }` whose SQL/TS mapping (e.g. vote-count buckets → 0.25..3) lives in the entry; manual `impact` input disappears. | New registry version + form/CSV column changes; switch per §4.3. |
| **D-P3** Reach weighted by voter company MRR | `reach: 'mrr_weighted'` with the counting and freshness contract in §4.10. | New registry version; live-aggregate Reach provider; **if** the perf gate fails, one fork cache table + one F-8 job + rebuild tests. No upstream seam (upstream emits no MRR/assignment events, so no event hook is used). |
| **D-P4** Confidence free % / Effort T-shirt sizes | `FactorDef.kind`: `number` 0–100 % for free Confidence; `enum` with numeric values (S=0.5, M=1, L=3, XL=6 months) for T-shirt Effort. | New registry version; old rows follow D-P7. |
| **D-P2** BRICE (weighted sum vs multiplicative, "B" from revenue) | New registry key; "B" is a `manual` enum or a `derived` factor from MRR (then §4.10 applies); formula shape is `compute`/`scoreSql`. | New registry entry; §4.10 work if "B" uses revenue. |

### 4.3 Score at read time (with D-P7)

**Active config.** Every read/sort/write path first reads `fork_settings['prioritization']` in TS (one query per
request; no module state; correct under pooled tenancy) → active entry `A`, `activeSet(A)`, `revision`.

**Per-row state** (row `fp` present):

| State | Condition | Sort tier | Sort value | Display |
| --- | --- | --- | --- | --- |
| `current` | `(fp.framework, fp.framework_version) ∈ activeSet(A)` | 2 | `A.scoreSql(fp.factors, reach)` (live) | `12.4` |
| `legacy` | not current, `NOT fp.needs_rescore` | 1 | `fp.frozen_score` | `9.8 · RICE v1 · frozen 2026-10-01` |
| `needs_rescore` | not current, `fp.needs_rescore` | 0 | `-1` | "Needs re-scoring (was 9.8 · RICE v1)" |
| `unscored` | no row | 0 | `-1` | — |

Current takes precedence over the marker (so a switch back to a row's version makes it current again).

```sql
-- scoreTierSql(postId), scoreValueSql(postId, reachSql) — correlated PK lookups, no status join
COALESCE((SELECT CASE
  WHEN fp.framework = :aKey AND fp.framework_version = ANY(:aVersions) THEN 2
  WHEN fp.needs_rescore THEN 0 ELSE 1 END
  FROM fork_post_prioritization fp WHERE fp.post_id = <postId>), 0)
COALESCE((SELECT CASE
  WHEN fp.framework = :aKey AND fp.framework_version = ANY(:aVersions) THEN <A.scoreSql(fp.factors, reach)>
  WHEN fp.needs_rescore THEN -1 ELSE fp.frozen_score END
  FROM fork_post_prioritization fp WHERE fp.post_id = <postId>), -1)
```

**Switch transaction** (`updatePrioritizationConfigFn`, only when `activeSet` changes; a cosmetic
`compatibleWith` bump is a plain config write):

1. `pg_advisory_xact_lock(<prioritization-config key>)` (exclusive; saves take it shared — §4.7).
2. Re-read config; validate new `A'` (non-retired); `revision + 1`.
3. Rows current under `A` and not in `activeSet(A')`: `frozen_score` = `A.scoreSql` with Reach now,
   `frozen_reach`, `frozen_at = now()`, `frozen_revision`; `needs_rescore = (post status ∈ rescore set now)`.
4. Rows already legacy (not current under `A`) and not in `activeSet(A')`: frozen values untouched;
   `needs_rescore = needs_rescore OR (post status ∈ rescore set now)`.
5. Rows in `activeSet(A')` (switch back): `needs_rescore = false` (they are current again).
6. Append one history row `action='invalidated'` per row changed in 3–4 (`score_at_time = frozen_score`);
   write config.

- **Rescore set** = `rescoreStatusSlugs` (default `open`, `under_review`) **plus** any `is_default` status
  (covers renamed/replaced `open`). Evaluated **once, at the switch**; a post moved to Planned afterwards keeps its
  marker, and a Planned legacy post moved back to Under Review stays `legacy` (the panel then offers scoring and
  says the score is from an old framework). Default for O-P11 🟡.
- **Frozen legacy (O-P12 🟡 default):** "keep their old score" = the number shown at the switch, not a recompute
  with the old formula and today's votes. Reasons: it is the literal reading of D-P7; it never changes silently
  under a label that says "RICE v1"; retired Reach sources (e.g. a weighted-Reach cache) need not be maintained
  forever; legacy rows sort in their own tier, so live comparability with current scores is not needed.
- **Mixed ordering (O-P10 🟡 default):** current tier before legacy tier before needs-re-scoring/unscored; within a
  tier by value, then `created_at`, `id`. Legacy numbers are never interleaved with current ones.
- **Perf:** two PK lookups per candidate post, no status join. Gate (Phase 4): `EXPLAIN ANALYZE` on 10k posts,
  p95 ≤ existing `priority` sort + 20 %.

### 4.4 Inbox sort key `score` + keyset pagination + row chip

In `post.inbox.ts` (two marked hunks, P-7) delegating to `lib/server/fork/prioritization/inbox-sort.ts`:

- `orderByMap.score` → `[desc(tier), desc(value), desc(posts.createdAt), desc(posts.id)]`.
- Cursor branch next to `sort === 'priority'`:
  ```sql
  (T(posts.id), V(posts.id), posts.created_at, posts.id)
    < ((SELECT T(p2.id) …), (SELECT V(p2.id) … WHERE p2.id = $cursor), $cursorDate, $cursorUuid::uuid)
  ```
  COALESCEd on both sides; no JS float round-trip.
- Known limitation (same as `votes`/`priority`): a vote or a switch between pages can move a post across the
  cursor. Accepted.
- **Row chip (Phase 4, with the sort — X-5).** P-11 in `feedback-table-view.tsx`: one hook call
  `useForkPrioritizationRowScores(filteredPosts)` → `listPostScoresFn({ postIds })` (≤ 100 ids, one query per
  loaded page, key `['fork','prioritization','rows',ids]`), and `{forkScoreChip(post.id)}` rendered next to
  `<FeedbackRow/>` in the row wrapper (bottom-right; the duplicate badge is top-right). Chip text follows the
  §4.3 Display column; hidden when lab off or caller lacks `post.view_private`. Shown in every sort; the mixed
  ordering is therefore always visible on the surface where it happens. Upstream `PostListItem` unchanged.

### 4.5 Post modal panel

- `MetadataSidebar`: `extraSections?: ReactNode` between ETA (`:602`) and Board (`:604`); other callers unchanged.
- `post-modal.tsx:530`: `extraSections={<PrioritizationPanel postId={postId} statusId={currentStatus?.id} voteCount={post.voteCount} />}`.
- `components/fork/prioritization/prioritization-panel.tsx`:
  - Query `['fork','prioritization',postId,statusId]` → `getPostPrioritizationFn` returning
    `{ enabled, editable, state: 'unscored'|'current'|'needs_rescore'|'legacy', framework, frameworkVersion,
    frameworkLabel, activeFramework: {key, version, revision}, factors|null, reach, reachAsOf, score|null, frozenAt,
    scoredBy, scoredAt, note, history[≤20] }`.
  - Hidden when lab off or caller lacks `post.view_private`.
  - Editable only when status slug ∈ `enabledStatusSlugs` **and** caller holds `prioritization.score`. Otherwise
    read-only: score + framework label, "last scored by X on D", history. Non-Under-Review posts show "Scoring
    opens when the post is Under Review" to key holders.
  - `needs_rescore` / `legacy`: badge per §4.3; form pre-filled from old factors where keys match.
  - Save sends `expectedFramework` / `expectedVersion` from `activeFramework`. On
    `PRIORITIZATION_CONFIG_CHANGED` or a status `ForbiddenError`: toast "Scoring settings or status changed —
    reloaded", refetch, keep typed values where factor keys still match.
  - Mutations via `useMutation` (`lib/client/fork/prioritization/`), invalidate panel key, row-score key and
    `inboxKeys.lists()`.
  - If no configured slug matches a live status, `prioritization.manage` holders see a settings hint.

### 4.6 Merge / unmerge / delete

- **Merge:** duplicate's row untouched (hidden with the duplicate); canonical keeps its own factors; its Reach
  rises via recomputed `vote_count`. Panel hint "N merged posts carry their own scores".
- **Unmerge:** duplicate's row live again; both Reach values follow recomputed counts.
- **Soft delete:** row retained. **Hard delete:** `ON DELETE CASCADE`.
- Frozen legacy values do not change on merge (frozen by definition). No merge-flow seam.

### 4.7 Server functions & services

`apps/web/src/lib/server/fork/prioritization/`:

| Function | Gate | Behaviour |
| --- | --- | --- |
| `getPostPrioritizationFn({ postId })` | `post.view_private` + lab | Row + state + score + editable + last 20 history rows |
| `listPostScoresFn({ postIds })` | `post.view_private` + lab | Map `postId → { state, score, frameworkLabel }` for the row chip (≤ 100 ids) |
| `setPostPrioritizationFn({ postId, factors, note?, expectedFramework, expectedVersion })` | `prioritization.score` + lab | Transaction: (1) `pg_advisory_xact_lock_shared(<config key>)`; (2) re-read config, require `(expectedFramework, expectedVersion) ∈ activeSet(A)` else `ConflictError('PRIORITIZATION_CONFIG_CHANGED')`; (3) `SELECT status_id FROM posts WHERE id = $1 FOR SHARE` + status slug ∈ `enabledStatusSlugs` else `ForbiddenError`; (4) validate factors against `A`, upsert row with `framework = A.key, framework_version = A.version`, `needs_rescore = false`, frozen columns null; (5) history with `reach_at_time` + `score_at_time`. |
| `clearPostPrioritizationFn({ postId, expectedFramework, expectedVersion })` | `prioritization.score` + lab | Same lock + config + status checks; delete row, history `action='cleared'` |
| `getPrioritizationConfigFn()` | `post.view_private` | `{ enabled, framework, version, revision, enabledStatusSlugs, rescoreStatusSlugs }` |
| `updatePrioritizationConfigFn(cfg)` | `prioritization.manage` + lab | Exclusive lock; non-retired framework; switch transaction per §4.3 when `activeSet` changes |
| `listPostPrioritization(actor, params)` (service) | used by MCP §4.9.1 and CSV | Shared query for portfolio listing (same tier/value SQL as the inbox) |

- Actor-parameterised services; no module-level state. Lab off ⇒ reads `{ enabled: false }`, writes `ForbiddenError`.
- All gates `requireAuth({ permission })` ⇒ regenerate `MATRIX.md`; no `classifications.ts` entry.
- No events/webhooks in v1.

### 4.8 Settings UI

Fork page `components/fork/settings/prioritization-settings.tsx`, registered via **F-4**, visible when lab on and
user holds `prioritization.manage`: framework picker (non-retired entries), scoring statuses (multi-select, default
Under Review), re-score statuses (default Open + default status + scoring statuses), Reach explanation (and
"Rebuild Reach now" if the §4.10 cache is on), and a framework-switch confirmation showing how many posts will be
marked "needs re-scoring" and how many will be frozen as legacy (dry-run count of §4.3 steps 3–4).

### 4.9 Exposure (D-P8)

- **CSV (Phase 5):** `post_prioritization.csv`
  (`post_id,framework,framework_version,state,needs_rescore,impact,confidence,effort,reach,reach_as_of,score,frozen_at,scored_by,scored_at`)
  via one line in `buildEntityList()`. `posts.csv` untouched. Values from `listPostPrioritization`. ZIP is
  export-only (§3).
- **MCP (Phase 5):** `mcp/tools/fork-prioritization.ts`, listed in the F-3 fork aggregator, both read-only,
  `post.view_private` via plan 10's per-tool permission gate (R-5), team principals only, API-key scope
  `read:feedback`: `get_post_prioritization` (one post, panel payload minus editability) and
  `list_post_prioritization` (§4.9.1).
- **REST:** later.

#### 4.9.1 Tower portfolio contract — `list_post_prioritization`

Input (zod):

```ts
{
  statusSlugs?: string[]; boardIds?: string[]
  states?: ('current' | 'legacy' | 'needs_rescore' | 'unscored')[]   // default: all except 'unscored'
  framework?: string; minScore?: number
  sort?: 'score' | 'scored_at' | 'newest'                            // default 'score' (= inbox score sort)
  cursor?: string; limit?: number                                    // 1..100, default 50
}
```

Output:

```ts
{
  enabled: boolean                                  // false ⇒ lab off, items []
  activeFramework: { key, version, label, revision }
  items: {
    postId, title, boardId, boardSlug, status: { slug, name }
    state, score: number | null, framework: string | null, frameworkVersion: number | null, frameworkLabel
    needsRescore: boolean, reach: number, reachAsOf: string, scoredAt: string | null, frozenAt: string | null
  }[]
  nextCursor: string | null                         // opaque keyset cursor, same tuple as §4.4
}
```

- Excludes merged duplicates and soft-deleted posts (same base conditions as the inbox, `post.inbox.ts:97`).
- `sort='score'` order and values are identical to the inbox `score` sort and the row chip (one shared service);
  parity test. Cursor invalid after a config `revision` change ⇒ `ConflictError('CURSOR_STALE')`, tower restarts.
- Denied without `post.view_private` (and with a principal that is not a team member). Read-only: no write tool.
- Tower requirement: the tenant custom role mapped from the tower's portfolio bundle must hold `post.view_private`.

### 4.10 Weighted Reach (only if D-P3 / D-P2 select revenue)

**Counting / dedup.** For canonical post `P`: voter set `V` = distinct `principal_id` over `post_votes` for `P`
and its merged children (same unique-voter basis as `vote_count`). Company set `C` = distinct non-null
`principal.company_id` over `V`. `weighted_reach = Σ_{c∈C} w(c.mrr_cents) + |{v ∈ V : company_id IS NULL}| × w_none`.
A company counts **once per post** however many of its people vote; a null-MRR company counts `w(null) = w_none`;
anonymous voters are company-less. `w` and `w_none` belong to the framework version (changing them = breaking bump).

**Sources that change it:** vote / unvote / proxy vote; post merge / unmerge; company MRR edit; company
attach/detach; company delete (FK set null); identity merge (votes re-pointed and deduped on the unique index);
imports. Upstream emits no events for the MRR edit and company reassignment (§3), so an event-driven cache would
silently go stale.

**Contract.**

1. Default: **no cache** — Reach provider is a live correlated aggregate (`post_votes` → `principal` →
   `companies`), exact on every surface. Gate: `EXPLAIN ANALYZE` of the inbox score sort at 10k posts / 200k votes
   within the §4.3 budget.
2. Only if the gate fails: `fork_post_reach_cache(post_id PK FK cascade, weighted_reach float8, voter_count int,
   company_count int, computed_at timestamptz)`, **fully rebuilt** per workspace by an F-8 job every 5 min
   (single transaction: upsert all posts with votes, delete rows for posts without votes), plus "Rebuild now" in
   settings. Missing row ⇒ Reach 0 until the next rebuild. Staleness bound ≤ 5 min + job time.
3. With the cache on, **every surface** (sort, row chip, panel, MCP, CSV) reads the cache and returns
   `reachAsOf = computed_at`, so the list and modal never disagree. History `reach_at_time` and switch-time
   freezes use the exact live aggregate.

## 5. Data model (fork lineage)

`packages/db/src/fork/schema/prioritization.ts`; migration `packages/db/drizzle-fork/NNNN_post_prioritization.sql`.

`fork_post_prioritization` (current score, 1:1 — D-P9):

| Column | Type | Notes |
| --- | --- | --- |
| `post_id` | `typeIdColumn('post')` **PK** | FK → `posts.id` `ON DELETE CASCADE` |
| `framework` | text not null | registry key |
| `framework_version` | int not null | registry version at save |
| `factors` | jsonb not null | manual factors only |
| `needs_rescore` | boolean not null default false | set by switch transaction; cleared by save or switch back (§4.3) |
| `frozen_score` | double precision null | legacy value frozen at switch |
| `frozen_reach` | double precision null | Reach at freeze |
| `frozen_at` | timestamptz null | |
| `frozen_revision` | int null | config revision of the freeze |
| `note` | text null | |
| `scored_by_principal_id` | `typeIdColumnNullable('principal')` | FK `ON DELETE SET NULL` |
| `scored_at` | timestamptz not null | |
| `created_at` / `updated_at` | timestamptz not null default now() | |

Check: `frozen_score IS NULL = frozen_at IS NULL`. Invariant (tested): a row not in the active set has
`frozen_score` not null.

`fork_post_prioritization_history` (append-only, D-P9): `id` uuid PK; `post_id` (FK cascade); `action`
(`set`|`cleared`|`invalidated`); `framework`, `framework_version`, `factors` (nullable for `cleared`);
`reach_at_time` float8; `score_at_time` double precision (audit only); `config_revision` int; `note`;
`scored_by_principal_id` (FK `SET NULL`); `created_at`. Index `(post_id, created_at desc)`.

`fork_settings['prioritization']` =
`{ "framework": "rice", "version": 1, "revision": 1, "enabledStatusSlugs": ["under_review"], "rescoreStatusSlugs": ["open", "under_review"] }`
(zod in `lib/shared/fork/prioritization/config.ts`; missing ⇒ defaults, revision 1; `is_default` status always
added to the rescore set at switch).

`fork_post_reach_cache` — only under §4.10 step 2 (separate additive migration).

- **Principal re-point (F-5):** both `scored_by_principal_id` columns registered in `fork-repoint.ts` as
  **exemptions** (staff-only scorer; anonymous principals never score).
- Additive only; fork drift check + journal-integrity test cover the tables.

## 6. Permissions (D-P6)

| Key | Status | Owner / Admin | Manager | Contributor | UX Team template | Enforced in |
| --- | --- | --- | --- | --- | --- | --- |
| `prioritization.score` | **new**, category `feedback` | ✅ (by construction: `ALL_PERMISSIONS`) | ❌ (in fork admin block) | ❌ | ✅ | set/clear fns, panel edit affordance |
| `prioritization.manage` | existing reserved (`:81`) | ✅ (by construction) | ❌ (**moved** to fork admin block) | ❌ | ✅ | config fn, settings page |
| `post.view_private` | existing | ✅ | ✅ | ✅ | ✅ (template needs it to see the panel) | read fns, panel, row chip, both MCP tools |

- **Mechanism (verified):** both keys go in the fork list spread into `WORKSPACE_ADMIN_PERMISSIONS`
  (`FORK_WORKSPACE_ADMIN_PERMISSIONS`, F-7). Manager = `ALL − WORKSPACE_ADMIN_PERMISSIONS` (`rbac-catalogue.ts:649`),
  so neither key reaches Manager; Owner/Admin derive from `ALL_PERMISSIONS` (`:645-646`) and **always hold every
  key** — "only UX scores" means "only UX Team among non-admin roles". On the next migrate `seedSystemData` deletes
  Manager's existing `prioritization.manage` row (`seed-system.ts:100-103`). The fork file references
  `'prioritization.manage'` as a typed string literal (no value import ⇒ no cycle). Nothing enforces the key
  upstream today (§3), so revoking it from Manager has no upstream side effect.
- UX Team role: custom role from plan 10's template installer with `prioritization.score`,
  `prioritization.manage`, `post.view_private`; installer must be Owner/Admin (ceiling). Existing installs get the
  keys via `syncPersonaTemplateFn`.
- `scopeForPermission` (`api-key-scopes.ts:247-254`) maps `score`/`manage` → `feedback` write; no scope-map edit.
- Upstream description still reads "(reserved; not yet enforced)"; tolerated. `bun run db:permissions` after editing.

## 7. Seams (own)

| # | Upstream file | Change | Why | Re-apply |
| - | --- | --- | --- | --- |
| P-1 | `apps/web/src/lib/shared/types/filters.ts:28` | `\| 'score'` on `InboxFilters.sort` | Closed sort union | Re-add member |
| P-2 | `apps/web/src/lib/server/domains/posts/post.types.ts:146` | `\| 'score'` on `InboxPostListParams.sort` | Closed sort union | Re-add member |
| P-3 | `apps/web/src/lib/server/functions/posts.ts:94` | `'score'` in `listInboxPostsSchema` | Server validation | Re-add enum value |
| P-4 | `apps/web/src/lib/shared/post/views.ts:22` | `'score'` in `POST_VIEW_SORTS` | Saved views pin sorts | Re-add value |
| P-5 | `apps/web/src/routes/admin/feedback.tsx:20` | `'score'` in route search enum | `.catch(undefined)` drops unknown sorts | Re-add value |
| P-6 | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx:144-149` | Spread `...useForkPrioritizationSortOptions()` | Literal option list | Re-add hook + spread |
| P-7 | `apps/web/src/lib/server/domains/posts/post.inbox.ts` (`:217-252`, `:257-262`) | `score` in `orderByMap` + cursor branch → fork `inbox-sort.ts` (tier, value) | Inline sort/keyset logic | Re-add two marked hunks |
| P-8 | `apps/web/src/components/public/post-detail/metadata-sidebar.tsx` | `extraSections?: ReactNode` slot | No slot; shared with portal | Re-add prop + render line |
| P-9 | `apps/web/src/components/admin/feedback/post-modal.tsx` | Pass `<PrioritizationPanel/>` into slot | Only admin mount point | Re-add prop |
| P-10 | `apps/web/src/lib/server/domains/export/workspace-export.ts` | Fork exporter in `buildEntityList()` (Phase 5) | Closed entity list | Re-add import + entry |
| P-11 | `apps/web/src/components/admin/feedback/table/feedback-table-view.tsx` (`:236-248`) | `useForkPrioritizationRowScores(filteredPosts)` + `{forkScoreChip(post.id)}` beside `<FeedbackRow/>` (wrapper gains `relative`) | Mixed ordering must be visible where it happens (X-5); `FeedbackRow` has no slot and the list DTO stays upstream | Re-add hook line + chip line + class |

**Own count: 11** (P-1..P-9, P-11 Phases 3–4; P-10 Phase 5). **Via shared seams (not counted):** F-7 catalogue keys +
admin-block entries; F-6 Labs entry; F-3 MCP tools; F-4 settings page; F-5 re-point exemptions; F-8 reach
rebuild job (only under §4.10 step 2). **Deferred (Phase 6):** roadmap `sortFor` + roadmap enums.

## 8. Phases & validation gates

| Phase | Deliverable | Gate |
| --- | --- | --- |
| **0. Prereqs** | Foundations (F-1..F-8, `fork_settings`); plan 10 fork catalogue file, UX Team template, per-tool MCP gate | Merged; fork drift green |
| **1. Schema + registry** | Fork tables; `frameworks.ts` (RICE v1), `framework-sql.ts`, config; Labs entry (F-6); keys in fork + admin block (F-7); UX Team template keys; re-point exemptions (F-5) | Unit: RICE math, validation, `compatibleWith` equivalence. DB: TS/SQL parity over every entry. `seedSystemData`: Manager lacks both keys, Owner/Admin hold both. **Pooled:** fork lineage applied fleet-wide before dependent code. |
| **2. Backend** | Services + fns (§4.7) incl. switch transaction and save guard | Integration per §9 (authz, status gate, stale-form conflict, switch semantics, history). `MATRIX.md` regenerated. |
| **3. Post-modal panel** | P-8, P-9; panel | Portal + roadmap modal unchanged (snapshot). Manual: Under Review → score → vote on portal → score rose; move to Planned → read-only. |
| **4. Inbox sort + row chip** | P-1..P-7, **P-11** (chip ships with the sort) | Keyset: 3 pages over current / legacy / needs-re-scoring / unscored / zero-vote posts, no dup/skip, tier order held. Chip matches sort value on every row. `EXPLAIN ANALYZE` in budget. `priority` sort regression. Saved view round-trip. |
| **5. Settings + exposure** | Settings page (F-4); CSV (P-10); `get_post_prioritization` + `list_post_prioritization` (F-3) | Switch per §9; ZIP has `post_prioritization.csv`, `posts.csv` byte-identical; MCP list parity with inbox; MCP denied without `post.view_private`. |
| **6. Later — not delivered by Phases 0–5** | D-P1..D-P4 variants, BRICE, weighted Reach (§4.10), roadmap score ordering, REST | Per item. Until then the feature is **RICE on provisional scales with Reach = vote count only**; answers to D-P1..D-P4 are not implemented by this plan's core phases. |

Rollback: disable the lab. Code rollback leaves fork tables (additive); reset pinned views with
`UPDATE post_views SET filters = filters - 'sort' WHERE filters->>'sort' = 'score'`. Reverting D-P6 is a fork-block
edit + migrate (reconcile restores Manager rows).

## 9. Testing strategy

- **Unit:** per-entry `compute()`, factor-schema generation (enum/number/derived), config defaults, state/tier
  classification (`current` / `legacy` / `needs_rescore` / `unscored`), `compatibleWith` entries share factor
  schema and `compute`.
- **DB integration:** SQL/TS parity; upsert + history atomicity; server-side status gate; merge/unmerge Reach;
  cascade.
- **Switch semantics (mandatory):**
  - Post in Under Review at switch → `needs_rescore`; then moved to Planned → **still** `needs_rescore`.
  - Post in Planned at switch → `legacy` with frozen value; then moved to Under Review → **still** `legacy`
    (editable); votes added after the switch do **not** change its displayed score.
  - Renamed default status counts as re-score status. Cosmetic `compatibleWith` bump → rows stay `current`, no
    history rows. Switch A→B→A → A-scored rows `current` again with marker cleared.
  - Invariant: every non-current row has `frozen_score`. Dry-run count in settings equals rows changed.
- **Stale-form save (mandatory):** load form under v1, switch to v2 in another session, save → 409
  `PRIORITIZATION_CONFIG_CHANGED`, no row/history write. Concurrent switch and save serialise (advisory lock): the
  save is either marked/frozen by the switch or rejected. Status moved Under Review → Planned after load → save
  `ForbiddenError`.
- **Inbox:** keyset suite modelled on `priority`/`votes` including tiers; filters combined with `score`; facet
  counts unaffected; row chip values equal sort values.
- **MCP portfolio (mandatory):** `list_post_prioritization` order/values equal the inbox `score` sort across pages;
  filters; limit bounds; `CURSOR_STALE` after a switch; excludes merged/soft-deleted; denied without
  `post.view_private` and for non-team principals; lab off ⇒ `enabled:false`.
- **Weighted Reach (when §4.10 lands, mandatory then):** two voters from one company count once; company-less and
  null-MRR voters; after MRR edit, attach/detach, company delete, identity merge, unvote and post merge/unmerge the
  Reach reflects the change (live mode immediately; cache mode after one rebuild); all surfaces return the same
  `reachAsOf`.
- **Authz:** matrix snapshot; Manager and Contributor denied score + manage; UX Team custom role allowed on
  dashboard, REST and MCP (plan 10 D3 enforcement).
- **Isolation:** no fork fields in portal/widget/public API; pooled probe after fleet migration.
- **Regression:** `priority` sort, ETA editor, portal sidebar, upstream `posts.csv` tests.

## 10. Open items

| Ref | Item |
| --- | --- |
| D-P1 ⏳ | Reach = vote count (provisional) vs Impact derived from votes. |
| D-P2 ⏳ | BRICE formula, scales, weighted vs multiplicative, whether "B" uses company revenue. |
| D-P3 ⏳ | Reach weighted by voter company MRR vs raw count. Weighted follows §4.10 (live aggregate, cache only if needed). |
| D-P4 ⏳ | Confidence fixed 50/80/100 % (provisional) vs free %; Effort person-months (provisional) vs T-shirt sizes. |
| O-P10 🟡 | After a framework switch, should old-framework scores sort after all current-framework scores (default) or be mixed in numerically with them? |
| O-P11 🟡 | Should "needs re-scoring" be decided once at the switch from each post's status at that moment (default), or re-checked from the post's current status every time it is shown? |
| O-P12 🟡 | Should posts that keep an old-framework score show the score as it was at the switch (default, frozen), or keep recalculating it from new votes with the old formula? |

## 11. Relationship to other v2 plans

- **Foundations / `02-fork-conventions.md`:** fork lineage, `fork_settings`, F-3/F-4/F-5/F-6/F-7/F-8, `SEAMS.md`
  (P-1..P-10 + new P-11).
- **10-rbac-persona-extensions.md:** this plan relies on `FORK_WORKSPACE_ADMIN_PERMISSIONS` holding both
  prioritization keys, the "UX Team" template holding `prioritization.score`, `prioritization.manage`,
  `post.view_private`, and the per-tool MCP permission gate (R-5).
- **20-control-tower.md:** consumes `list_post_prioritization` (§4.9.1) with the admin's own token (D-C2);
  requires `post.view_private` in the mapped tenant role; no write path.
- **30 / 40 / 60:** independent.
