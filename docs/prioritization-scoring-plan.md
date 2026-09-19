# Feedback Prioritization Scoring (RICE / BRICE) — Design Plan

> **Status:** Proposal / planning only. Nothing here is implemented.
> **Goal:** Give **product teams** (not end users) the ability to score a feedback post with a
> prioritization framework (RICE / BRICE) **in the admin app**, surfaced when a post is marked
> **Under Review**, by **extending the feedback (post) object** with structured scoring.

## 0. Important context — why it "felt like it was already there"

The RBAC permission **`PRIORITIZATION_MANAGE` (`'prioritization.manage'`)** already exists and is
explicitly annotated **"RESERVED: prioritization frameworks"** in `packages/db/src/rbac-catalogue.ts`
(mirrored in `apps/web/src/lib/shared/permissions.ts`), and it is already granted to the **Manager**
system role (not to Contributor). But it is **not enforced anywhere in app code**, and there are **no
scoring fields on the post object**. So the hook was scaffolded and the feature never built — this plan
builds it into that reserved seam.

Also note: the admin feedback inbox already has a **`'priority'` sort**, but that is an _engagement_
score (`voteCount*3 + commentCount*2 + recency`, `post.inbox.ts` `priorityScoreSql`), **not** RICE.
We must **not** overload it; we add a distinct score + sort key.

## 1. Requirements

| #   | Requirement                                                                                         |
| --- | --------------------------------------------------------------------------------------------------- |
| R1  | Product-team members can assign a prioritization score to a feedback post in the admin UI.          |
| R2  | Scoring is surfaced/enabled when a post is **Under Review** (configurable which status[es]).        |
| R3  | Extend the **post/feedback object** with structured scoring (factors + computed score), staff-only. |
| R4  | Support **RICE**, and **BRICE** (confirm exact factors — see §12), via a configurable framework.    |
| R5  | Sort/filter the inbox by score; optionally feed roadmap ordering (follow-up).                       |
| R6  | Team-only (never visible to portal/end users); permissioned; audited.                               |
| R7  | Upgrade-safe and multi-tenant-safe (works in single and pooled tenancy).                            |

## 2. TL;DR recommendation

- Add a **dedicated `post_prioritization` table** (1:1 current score per post) + an append-only
  **`post_prioritization_history`** for the audit trail — **not** `posts.customFieldValues` (those are
  submit-time intake fields), and not new columns on `posts` (keeps the hot table lean; scoring is a
  staff sidecar like `post_notes`).
- Make the framework **configurable per workspace** (`RICE` default, `BRICE` variant, or custom
  factors/weights/formula), stored in settings. Compute the score **server-side, deterministically**,
  and persist it for indexing/sorting.
- Build the write path by **mirroring the existing ETA field** (`setPostEtaFn` → `updatePost` →
  optimistic `useSetPostEta`), gated by the **already-reserved `PRIORITIZATION_MANAGE`** permission.
- Surface a **Prioritization panel** in the post detail (`MetadataSidebar`, after Status / before ETA),
  shown+editable when the post's status is in the configured "review" set and the user has the
  permission; read-only score badge otherwise.
- Add a **new inbox sort key** (e.g. `rice_score`) + optional score column — leave the existing
  engagement `priority` sort untouched.

## 3. Current-state findings (what to reuse / respect)

### 3.1 Post object & statuses

- `posts` (`packages/db/src/schema/posts.ts`): rich object with `statusId → post_statuses`, plus existing
  structured extensions `customFieldValues` (intake), `widgetMetadata`, and `summaryJson` ("structured
  JSON for PM triage"). `eta` timestamp exists for date roadmaps. No scoring fields.
- `post_statuses` (`packages/db/src/schema/statuses.ts`): per-workspace, customizable. **"Under Review"**
  is a default status (`slug: 'under_review'`, `category: 'active'`, `isDefault: false`). Slug is unique
  per workspace but **can be renamed/deleted**, so detection needs a config + graceful fallback.

### 3.2 The clean seam to copy — the ETA field

- RPC: `setPostEtaFn` (`apps/web/src/lib/server/functions/posts.ts`), gated `requireAuth({ permission: POST_SET_ETA })`, delegates to `updatePost(id, { eta }, actor)` (`domains/posts/post.service.ts`).
- Client: `useSetPostEta` (`apps/web/src/lib/client/mutations/posts.ts`) — optimistic update.
- UI: `MetadataSidebar` row (`components/public/post-detail/metadata-sidebar.tsx`), wired in `components/admin/feedback/post-modal.tsx` (`handleEtaChange`).
- **Prioritization mirrors this shape exactly.**

### 3.3 Domain / RPC / permission patterns

- Actor-parameterized services (`changeStatus(postId, statusId, actor)` in `post.status.ts`; `updatePost(id, input, actor)` in `post.service.ts`) vs `requireAuth()` RPC layer (`functions/posts.ts`). Add scoring at both layers, same split.
- Status changes write `createActivity({ type: 'status.changed', metadata: { toSlug } })` (slug-based so renames don't break analytics) — mirror with a `prioritization.scored` activity.
- Permissions: `PRIORITIZATION_MANAGE` (reserved) for write; `POST_VIEW_PRIVATE` for staff read; team detection via `isTeamMember(role)` (`lib/shared/roles.ts`). Portal users never reach the admin `PostModal`.

### 3.4 Inbox listing & sort

- `listInboxPosts` (`domains/posts/post.inbox.ts`) with `orderByMap`; existing `priority` = engagement `priorityScoreSql`. Sort enum lives in `lib/shared/types/filters.ts` (`InboxFilters.sort`), `post.types.ts` (`InboxPostListParams`), `functions/posts.ts` (`listInboxPostsSchema`), and saved views `lib/shared/post/views.ts` + `post_views.filters`. Adding a new sort key touches these.
- List item type `PostListItem` (`post.types.ts`); detail type `PostDetails` (`lib/shared/types/inbox.ts`) — extend both with score fields.

### 3.5 Roadmap ordering

- Column roadmaps group by `statusId`; within a column sort is votes/newest/oldest (`domains/roadmaps/roadmap.query.ts` `sortFor`). Date roadmaps bucket by `posts.eta`. **No score-based ordering today** — a score→roadmap sort is a clean follow-up.

## 4. Data model (new, additive)

New `packages/db/src/schema/post-prioritization.ts`.

`post_prioritization` (current score; one row per post):

| Column                     | Type                           | Notes                                                                               |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `id`                       | typeid (`ppri_…`)              | PK                                                                                  |
| `post_id`                  | typeid (`post`) FK, **unique** | 1:1 with post; `ON DELETE CASCADE`                                                  |
| `framework`                | text                           | `rice` \| `brice` \| `custom` (snapshot of the framework used)                      |
| `factors`                  | jsonb                          | Raw inputs keyed by factor, e.g. `{ reach, impact, confidence, effort, business? }` |
| `score`                    | real                           | **Computed, indexed** for sort/filter                                               |
| `scored_by_principal_id`   | typeid (`principal`)           | Staff actor; `ON DELETE SET NULL`                                                   |
| `scored_at`                | timestamptz                    | Last scored/updated                                                                 |
| `note`                     | text (nullable)                | Optional rationale                                                                  |
| `created_at`, `updated_at` | timestamptz                    |                                                                                     |

Indexes: unique on `post_id`; `index(score)` (desc) for sort; optional composite `(status-filtered) ` handled via join to posts.

`post_prioritization_history` (append-only audit; optional but recommended):

| Column                                         | Notes                    |
| ---------------------------------------------- | ------------------------ |
| `id` (`pprih_…`)                               | PK                       |
| `post_id` (FK)                                 |                          |
| `framework`, `factors` (jsonb), `score` (real) | Snapshot at time of edit |
| `scored_by_principal_id`, `scored_at`          | Who/when                 |
| `note`                                         |                          |

Rationale for a dedicated table (vs `customFieldValues` / columns on `posts`):

- Staff triage data, **not** submitter intake (custom fields are create-time, public form).
- Structured + **indexable** `score` for sort without bloating the hot `posts` row.
- Naturally **permissioned + audited**, and mirrors the staff-only sidecar precedent (`post_notes`).
- Framework snapshot + history give product teams a defensible trail when weights change.

## 5. Framework configuration (RICE / BRICE / custom)

Store a workspace-level **prioritization config** (in `settings` — e.g. a new `settings.prioritization_config` JSON column or a key in an existing settings blob), shape (client-safe, validated):

```jsonc
{
  "enabled": true,
  "framework": "rice", // rice | brice | custom
  "enabledStatusSlugs": ["under_review"], // when scoring is surfaced/required
  "factors": [
    { "key": "reach", "label": "Reach", "min": 0, "max": 100000, "step": 1 },
    { "key": "impact", "label": "Impact", "scale": [0.25, 0.5, 1, 2, 3] },
    {
      "key": "confidence",
      "label": "Confidence",
      "min": 0,
      "max": 1,
      "step": 0.05,
      "asPercent": true,
    },
    { "key": "effort", "label": "Effort (person-months)", "min": 0.25, "step": 0.25 },
    // BRICE adds e.g. { "key": "business", "label": "Business value", "scale": [1,2,3,5,8] }
  ],
  "formula": "rice", // rice: (reach*impact*confidence)/effort ; brice: see §12
}
```

- **RICE** score = `(reach × impact × confidence) / effort`.
- **BRICE** = RICE plus a **Business value** factor — exact formula to confirm (§12); default proposal:
  `(business × reach × impact × confidence) / effort`, or a weighted variant.
- **custom** = admin-defined factors + weights + formula (multiplicative/additive). Keep the evaluator
  small and safe (no arbitrary code — a whitelisted formula/weights model).
- Compute **server-side** in a shared, tested pure function; persist `score`. Store `framework` on the
  row so a later config change doesn't silently rewrite historical scores (recompute is explicit).

## 6. Backend design

New domain module `apps/web/src/lib/server/domains/posts/post.prioritization.ts`:

- `computeScore(factors, config): number` — pure, unit-tested (RICE/BRICE/custom).
- `setPrioritizationScore(postId, input, actor)` — validate against config, compute score, upsert
  `post_prioritization`, append `post_prioritization_history`, `createActivity({ type: 'prioritization.scored', metadata: { score, framework } })`.
- `clearPrioritizationScore(postId, actor)`.
- `getPrioritization(postId)` and batch `getPrioritizationForPosts(postIds)` for list hydration.

Server functions (`apps/web/src/lib/server/functions/posts.ts`), mirroring `setPostEtaFn`:

- `setPostPrioritizationScoreFn` — `requireAuth({ permission: PERMISSIONS.PRIORITIZATION_MANAGE })` → `setPrioritizationScore(...)`.
- `clearPostPrioritizationScoreFn` — same permission.
- Extend `fetchPostWithDetails` / `PostDetails` to include the current score; extend `listInboxPosts` /
  `PostListItem` to include `score` (left join) when requested.
- `fetchPrioritizationConfigFn` (read) + admin `updatePrioritizationConfigFn` (settings permission).

Client mutations (`apps/web/src/lib/client/mutations/posts.ts`): `useSetPostPrioritizationScore()` (optimistic, mirroring `useSetPostEta`), `useClearPostPrioritizationScore()`.

## 7. "Under Review" gating

- Detection driven by **config `enabledStatusSlugs`** (default `['under_review']`), resolved against the
  workspace status list by **slug** (consistent with existing slug-based inbox filters + analytics
  `toSlug`), with a graceful fallback if the slug was renamed/deleted (surface a settings hint rather
  than silently disabling).
- Panel behavior:
  - Status ∈ enabled set **and** user has `PRIORITIZATION_MANAGE` → **editable** scoring form.
  - Already scored but status not in set → **read-only** score badge (history preserved).
  - No permission → hidden (or read-only badge if `POST_VIEW_PRIVATE`).
- Optional: a soft nudge ("score this before planning") when a post enters Under Review without a score.

## 8. UI design

- **Post detail (primary):** a **Prioritization** panel via `MetadataSidebar` (after Status, before ETA),
  wired from `post-modal.tsx` like `handleEtaChange`. Inputs per configured factor (number/slider/scale
  select), a **live-computed score** preview, Save, and a small "last scored by X" line. Uses
  `usePermission(PRIORITIZATION_MANAGE)`.
- **Inbox list:** add a **score column** (`feedback-row.tsx` / `PostCard`) and a **new sort key**
  `rice_score` (label e.g. "Priority score") in `feedback-table-view.tsx`, `InboxFilters.sort`,
  `listInboxPostsSchema`, and saved-views `POST_VIEW_SORTS`. **Do not** change the existing `priority`
  (engagement) sort.
- **Admin settings:** a Prioritization settings page (framework picker RICE/BRICE/custom, factor
  definitions, enabled statuses) — mirror an existing `admin/settings.*` page.
- **Optional roadmap (follow-up):** add a `score` sort option to roadmap columns (`roadmap.query.ts`
  `sortFor`) so planned work can order by score.

## 9. Permissions & visibility

- Write: `PERMISSIONS.PRIORITIZATION_MANAGE` (already reserved; granted to Manager, not Contributor — sensible default; adjust role matrix if product wants Contributors to score).
- Read (staff): `POST_VIEW_PRIVATE`. **Never** exposed on portal/public post reads or the widget — scoring is staff-only, like `post_notes` and private comments.
- Config edit: a settings-management permission (e.g. `SETTINGS_MANAGE`).

## 10. Multi-tenant & upgrade-safety

- **Multi-tenant:** the new table ships via the standard migrator and the fleet migrator
  (`apps/web/scripts/fleet-migrator.ts`) across all tenants; config is per-workspace. Nothing tenancy-specific.
- **Upgrade-safety:** almost entirely **additive** — new table(s), new `post.prioritization.ts`, new RPCs,
  new client mutations, a new settings page, a new sort key, and a new sidebar panel. Enforcing the
  **already-reserved** `PRIORITIZATION_MANAGE` is additive. Small, localized edits to shared enums
  (`InboxFilters.sort`, `PostViewFilters.sort`, `PostListItem`, `PostDetails`) and the inbox query.
  Because the permission was pre-reserved upstream, this feature is a strong **upstream-contribution**
  candidate rather than a divergent fork.

## 11. Optional enhancements (later)

- **AI-suggested score:** reuse the existing AI/PM-triage infra (`posts.summaryJson`, assistant domain)
  to propose RICE/BRICE factor values a human confirms.
- **Cross-app rollup (Tier B):** surface/compare scores across apps in the fleet control tower
  (`docs/multi-tenant-control-tower-plan.md`) for portfolio prioritization — read-only fan-out.
- **Consensus scoring:** per-reviewer scores averaged into a consensus (would make the table
  per-(post,reviewer) instead of 1:1) — only if the team wants multi-voter RICE.
- **Roadmap auto-promotion:** suggest promoting top-scored Under-Review posts to Planned.

## 12. Open questions

1. **BRICE definition** — confirm the factors and formula. Assumed: RICE + **B**usiness value; default
   formula `(business × reach × impact × confidence) / effort`. Is "B" business value, or something else
   (e.g. **B**rand, **B**udget)? Weighted or multiplicative?
2. **Single score vs per-reviewer consensus?** (Affects table shape.)
3. **Strict gating** to Under Review only, or allow scoring in any active status (with Under Review as the
   prompt)?
4. **Should score feed the roadmap** ordering now, or later?
5. **History table** — needed for v1, or is last-score-only enough?
6. **Who can score** — Managers only (current default), or also Contributors?
7. **Factor input styles** — free number vs fixed scales (e.g. impact 0.25–3, confidence %)?

## 13. Phased plan (with validation)

| Phase                          | Deliverable                                                                                                                                                                             | Validation                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **1. Schema + compute**        | `post_prioritization` (+ history) table; `computeScore()` pure fn; framework config type + validation                                                                                   | Unit tests for RICE/BRICE/custom math; migrate locally                                 |
| **2. Backend**                 | `post.prioritization.ts` service; `setPostPrioritizationScoreFn` / clear / read gated by `PRIORITIZATION_MANAGE`; extend `PostDetails`/`PostListItem`; `prioritization.scored` activity | DB/integration tests; score set/clear as Manager, denied as Contributor                |
| **3. Post-detail UI**          | Prioritization panel in `MetadataSidebar` + `post-modal.tsx`; gated by status set + permission; live score                                                                              | Manual: mark a post Under Review, enter factors, see computed score, save (optimistic) |
| **4. Inbox sort/column**       | New `rice_score` sort + score column; extend saved views                                                                                                                                | Sort inbox by score; verify existing engagement `priority` sort unchanged              |
| **5. Settings**                | Admin Prioritization settings (framework, factors, enabled statuses)                                                                                                                    | Switch RICE↔BRICE, change enabled status, verify gating/compute reflect config         |
| **6. (Optional) Roadmap + AI** | Score sort for roadmap; AI-suggested factors                                                                                                                                            | Roadmap orders by score; AI proposes a score a human accepts                           |

## 14. Validation & testing strategy

- **Unit:** `computeScore()` for RICE/BRICE/custom incl. edge cases (effort 0 guard, confidence %, missing factors).
- **DB/integration:** upsert + history append + activity; permission enforcement (Manager vs Contributor); read excluded from public/portal/widget projections.
- **Manual (GUI):** the Under-Review scoring flow in the admin post modal, the inbox score column/sort, and the settings page — recorded as a walkthrough.
- **Regression:** confirm the existing `priority` (engagement) sort and ETA field are unaffected.

## 15. File / seam index

Reuse (existing):

- Post object/status: `packages/db/src/schema/posts.ts`, `statuses.ts`
- ETA template: `functions/posts.ts` (`setPostEtaFn`), `domains/posts/post.service.ts` (`updatePost`), `lib/client/mutations/posts.ts` (`useSetPostEta`)
- Status service + activity: `domains/posts/post.status.ts` (`changeStatus`, `createActivity`)
- Inbox list + sort: `domains/posts/post.inbox.ts` (`listInboxPosts`, `priorityScoreSql`), `lib/shared/types/filters.ts`, `lib/shared/post/views.ts`, `post_views` schema
- Post detail UI: `components/public/post-detail/metadata-sidebar.tsx`, `components/admin/feedback/post-modal.tsx`, `feedback-table-view.tsx`, `feedback-row.tsx`
- Permissions: `packages/db/src/rbac-catalogue.ts` + `lib/shared/permissions.ts` (`PRIORITIZATION_MANAGE`, `POST_VIEW_PRIVATE`), `lib/shared/roles.ts` (`isTeamMember`)
- Types: `post.types.ts` (`PostListItem`, `InboxPostListParams`), `lib/shared/types/inbox.ts` (`PostDetails`)
- Roadmap: `domains/roadmaps/roadmap.query.ts` (`sortFor`)

New (to build, additive):

- `packages/db/src/schema/post-prioritization.ts` (+ migration)
- `apps/web/src/lib/server/domains/posts/post.prioritization.ts`
- `setPostPrioritizationScoreFn` / `clearPostPrioritizationScoreFn` / read + config RPCs in `functions/posts.ts`
- `useSetPostPrioritizationScore()` in `lib/client/mutations/posts.ts`
- Prioritization panel component + `MetadataSidebar` wiring
- `admin/settings.prioritization.tsx`
- New `rice_score` sort key across the shared enums + inbox query
- Prioritization config in settings + validation module

## 16. Relationship to other plans

- Independent of the multi-app/control-tower and announcements plans, but **composes** with the control
  tower: once scoring exists per app, the Tier-B console can aggregate/compare scores across apps for
  portfolio prioritization (optional, §11).
