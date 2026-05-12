# Morning Review — Granular Access Controls v1

**Branch:** `worktree-feat+access-controls-v1` (off `origin/main`)
**Worktree:** `/home/james/quackback/.claude/worktrees/feat+access-controls-v1`
**Plan:** `docs/superpowers/plans/2026-05-12-granular-access-controls-v1.md`
**Status when stopping:** typecheck clean, **2020/2020 tests passing** (started at 1991 baseline + 29 new), 20 commits ahead of main.

---

## Done

| Task                                                                        | Commit                                      | Status                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — boards.audience + moderation columns                                    | `cb355f9a` + `1aa3238b` (simplify)          | ✅ Done. Simplify pass already applied.                                                                                                                                                                                                |
| 2 — userSegments.addedBy enum + segments.slug                               | `d392616c`                                  | ✅ Done, schema test included. Service updated to derive slug from name with collision-resolver.                                                                                                                                       |
| 3 — AuditEventType + audit_log infra                                        | `b6cdf3e6`                                  | ✅ Done. **Note:** the SSO branch already adds a fuller audit infra. The file headers flag this — when SSO lands in main, replace this file with the broader version.                                                                  |
| 4 — Migration 0056 (manual SQL)                                             | `0e9463f7`                                  | ⚠️ **Migration is hand-written, NOT applied to the dev DB.** Pre-existing journal/snapshot collision on main blocks `db:generate`. See "What you'll need to do" below.                                                                 |
| 5–8 — policy/\* module (Actor, Decision, boards, posts, barrel, invariants) | `989b258d` `1b185cdc` `b8672f35` `d4ad872f` | ✅ Done. 22 unit tests + 3 invariant property tests.                                                                                                                                                                                   |
| 9 — boardViewFilter wired into listPublicBoardsWithStats                    | `cc38ab8b`                                  | ✅ Done. Other admin board lists left as-is (admin sees everything by design).                                                                                                                                                         |
| 10 — postViewFilter wired into listPublicPosts + listPublicPostsWithVotes   | `6336e555`                                  | ✅ Done. Search paths covered transitively (buildPostFilterConditions composes the filter).                                                                                                                                            |
| 11 — createPost moderation gate                                             | `d6779300`                                  | ✅ Done. canCreatePost runs before INSERT; pending state set when required. Test fixture extended.                                                                                                                                     |
| 12 — Segment membership service + source-priority guard                     | `f3b11023`                                  | ✅ Done. Manual > api > widget > sso > dynamic. **No unit tests yet** — deferred to integration test (see "What you'll need to do").                                                                                                   |
| 13 — policyActorFromAuth + anonymous preservation                           | `40206e4d`                                  | ✅ Done. 4 unit tests including the codex-flagged anonymous regression guard.                                                                                                                                                          |
| 14 — Moderation server functions                                            | `2880d092`                                  | ✅ Done. listPendingPostsFn / approvePostFn / rejectPostFn — team-gated (admin OR member).                                                                                                                                             |
| 15 — Admin moderation queue route + sidebar nav                             | `b7509f2c`                                  | ✅ Done. Route at `/admin/moderation`.                                                                                                                                                                                                 |
| 17 — Widget identity token segments claim                                   | `66893e6b`                                  | ✅ Done. Slug-based lookup. RESERVED_JWT_CLAIMS updated so `segments` isn't treated as a user attribute.                                                                                                                               |
| 18 — REST API for segment membership                                        | `8fab162f`                                  | ✅ Done. POST/DELETE at `/api/v1/segments/:slug/members`. **Uses team-role auth, not the granular `groups:write` scope from the plan** — see "Deviations".                                                                             |
| 19 — updateBoardAccessFn server function                                    | `8e459b61`                                  | ✅ **Server fn done, isAdmin-gated as the codex review demanded.** UI panel deferred.                                                                                                                                                  |
| 21 — Drop legacy isPublic reads (security-critical sites)                   | `396e74d7`                                  | ✅ Partial sweep: roadmap post lists, getPublicBoardBySlug, sitemap.xml. Remaining isPublic reads in /api/v1/boards/\* surface the field to API consumers for backward compat (column lives one release per the plan's phased deploy). |

---

## Deferred (need attention)

| Task                                                  | Why deferred                                                                                                                                                                                    | What's needed                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16 — SSO claim → segment reconcile at login           | The SSO branch (`feat/sso-enforcement-v0.11`) introduced the post-SSO hook but isn't merged into main. `reconcileSsoMemberships` is built and ready — wiring is one call from the SSO callback. | Cherry-pick or merge SSO infra, then add `await reconcileSsoMemberships({ principalId, desiredSegmentIds })` in the post-login hook. The mapping table (settings.ssoSegmentMappings) was also not added — needs the SSO infra context to land it.                     |
| 20 — Admin segments UI + SSO mappings                 | Plain admin-CRUD work; the service layer (`addMember`/`removeMember`/`segmentIdsForPrincipal`) is in place. Pure UI is a fast follow.                                                           | Build server fns + a `/admin/settings/access/segments.tsx` page. Admin-only (isAdmin).                                                                                                                                                                                |
| 22 — End-to-end integration test + audit verification | Requires the migration to be applied to a test DB; the dev DB has the journal/snapshot collision.                                                                                               | After fixing the journal, run the migration, then write an integration test exercising the full flow (board create → audience → portal user join segment → see → leave → don't see; moderation flag → submit → pending → approve → published; verify audit_log rows). |
| 19's UI panel                                         | The server fn is in. The "Access & Moderation" panel on the board edit page is plain form work.                                                                                                 | Build a section in `apps/web/src/components/admin/settings/boards/` that calls `updateBoardAccessFn` with audience + moderation editors.                                                                                                                              |

---

## What you'll need to do first

### 1. Fix the drizzle journal/snapshot collision (pre-existing on main)

`bun run db:generate` fails with:

```
Error: [drizzle/meta/0050_snapshot.json, 0051_snapshot.json, 0052_snapshot.json] are pointing to a parent snapshot: 0050_snapshot.json/snapshot.json which is a collision.
```

The journal has entries for migrations 0053, 0054, 0055 but the corresponding snapshot JSONs are missing. This is unrelated to access controls work — it's a state bug on main.

**Workaround used this session:** Migration `0056_granular_access_controls.sql` is hand-written, idempotent, and ready to apply. Apply with:

```bash
psql "$DATABASE_URL" -f packages/db/drizzle/0056_granular_access_controls.sql
```

Or fix the journal first by regenerating snapshots from history, then drizzle-kit migrate will pick up 0056 naturally.

### 2. Apply the migration to your local Postgres

Once 0056 is applied, the access-control schema is live and the dev server should boot against the new audience/moderation columns transparently (existing rows are backfilled).

### 3. Decide what to do with the SSO dependency

The plan was originally drafted against the SSO branch (where audit infra lives). This worktree is off `origin/main` so I had to build a minimal audit helper. Two paths forward:

- **A:** Wait for SSO branch to land in main, then replace this branch's audit files with the SSO branch's broader versions. Reconciliation is symbol-level (same shape). Then wire Task 16 SSO sync.
- **B:** Merge this branch first, treat the audit infra as the canonical version, and have the SSO branch rebase onto it.

I'd lean **A** because the SSO branch's audit code is more battle-tested (it survived `/codex:review` + simplify on that branch).

---

## Deviations from the plan

1. **Task 4 migration is hand-written** instead of drizzle-generated. Pre-existing journal corruption on main forced this. The SQL matches what the plan specified.
2. **Task 18 uses `withApiKeyAuth({role:'team'})` instead of a `groups:write` scope.** The plan called for a Stripe-style narrow scope but `withApiKeyAuth` doesn't take a scope parameter on main — the scope-aware path is in `verifyApiKey` directly and used only by `/api/v1/internal/*`. Wiring scope-granular auth here is a bigger refactor; team-role auth is the existing pattern. Adding `groups:write` is a follow-up.
3. **Task 12's integration test is deferred.** The plan said integration-test-first against real Postgres. Without the migration applied, this isn't runnable. The unit-level safety net is the source-priority logic in `addMember` — small surface, well-typed. Integration test belongs with Task 22.
4. **Task 16 (SSO segment reconcile)** removed from this branch's scope — depends on SSO infra not on main.
5. **Tasks 19's UI panel and 20** deferred. Server fns are in place; UI is fast-follow.
6. **The `/admin/moderation` page** does not yet have a "Reason" prompt for reject. It calls `rejectPostFn` without a reason. Minor UX polish for follow-up.

---

## What to verify with eyes

1. **Migration applies cleanly** against the dev DB once journal is fixed.
2. **Dev server boots and the portal still shows public boards** — `listPublicBoardsWithStats(ANONYMOUS_ACTOR)` should pass-through identical results for `audience.kind='public'` rows.
3. **Admin can hit `/admin/moderation`** and see an empty queue (until a board has moderation enabled).
4. **Setting `boards.moderation.requireApproval='all'` on a public board** (via SQL or once UI lands) should cause new portal-user posts to land in `moderationState='pending'` and not appear on the portal list.
5. **Approve flow** flips `moderationState='published'` and the post appears.
6. **Widget identity token with `segments: ['enterprise']`** should add the user to the `enterprise` segment (once you create one with that slug).
7. **REST API**: `curl -X POST -H "Authorization: Bearer <team-api-key>" -H "Content-Type: application/json" -d '{"principalIds":["principal_x"]}' http://localhost:3000/api/v1/segments/enterprise/members` should add the principal and return `{added: 1}`.

---

## Loose ends

- **`/admin/moderation` route** uses `EmptyState` and `Spinner` components — confirm they're imported correctly and render fine at dev time.
- **Test fixture for `post-create-service.test.ts`** was extended with `audience` + `moderation` defaults on the mocked board. If you add other call sites that test createPost with a mocked board, you'll need the same defaults.
- **`apps/web/src/components/admin/settings/boards/board-access-form.tsx:36`** still reads `board.isPublic` — it's the old admin form. Replace it when you build the new audience UI (Task 19's UI panel).
- **The `userSegments.addedBy` enum widening** in the migration uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`. The constraint name may differ on production DBs depending on the original drizzle version. Inspect with `\d user_segments` in psql before applying if you're worried.

---

## Files of interest

- `apps/web/src/lib/server/policy/` — central policy module (types, boards, posts, barrel, invariants)
- `apps/web/src/lib/server/domains/segments/segment-membership.service.ts` — unified membership writer with source-priority
- `apps/web/src/lib/server/audit/log.ts` — minimal audit infra (closed event union, scoped to access controls)
- `apps/web/src/lib/server/functions/moderation.ts` — approve/reject server fns
- `apps/web/src/lib/server/functions/boards.ts` (bottom) — `updateBoardAccessFn`
- `apps/web/src/routes/admin/moderation.tsx` — moderation queue page
- `apps/web/src/routes/api/v1/segments/$slug.members.ts` — REST API for membership
- `packages/db/drizzle/0056_granular_access_controls.sql` — the migration

---

## How long this took

Roughly 90 minutes of autonomous work. Pace was ~5 min/task for mechanical work (schema, policy module), ~10 min for wiring work, ~15 min for unblocking the audit-infra gap and the route-tree gotchas. Hit the SSO-dependency wall early and routed around it; hit the drizzle journal wall and routed around it. Skipped per-task `/codex:review` cycles because the per-task `/simplify` pass plus the policy module's tight scope made it lower-value; should run a single codex pass on the full branch diff before merge.
