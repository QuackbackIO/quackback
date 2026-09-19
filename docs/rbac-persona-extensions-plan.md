# RBAC for Expanded Personas (UX / Dev / Stakeholders / Tier 1-2-3) — Analysis & Plan

> **Status:** Proposal / analysis only. Nothing here is implemented.
> **Question answered:** Do we need to extend/change the RBAC model to support expanded user types —
> UX team, dev team, stakeholders, Tier 1/2/3 agents, etc.?

## 1. Verdict

**No fundamental redesign is needed.** The RBAC model is well-architected and already anticipates this:
the permission catalogue is code-authoritative, **custom roles** exist for arbitrary permission bundles,
and the schema even reserves a `team_id` on role assignments for future team-scoping.

Most personas are simply **one custom role each** (or a system preset). However, to fully support the mix
you described, plan for up to **four targeted extensions** — only the ones your requirements actually need.
Three of them are **application-logic** changes (no DB migration); one needs a small schema/enum addition.

| Persona                      | Represented today as                                                                                                      | Needs extension?                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **UX team**, **Dev team**    | Custom role (feedback/config permission bundle)                                                                           | Only if they must be **board-scoped**                                                     |
| **Tier 1/2/3 agents**        | Team (routing, from the tiered-support plan) + custom role bundle (e.g. Contributor preset ± `conversation.*`/`ticket.*`) | Only if tier perms must be **team-scoped**, or people wear **multiple hats**              |
| **Stakeholders (read-only)** | Portal access + segments/board-access (seat-free) **or** a dashboard custom role (**consumes a seat**)                    | Needs extension for **seat-free dashboard viewing** and **strict read-only (no comment)** |

## 2. How the model works today (the parts that matter)

- **Two axes.** Legacy `principal.role` (`admin | member | user`) is the _teammate wall_ (dashboard vs
  portal); custom RBAC bundles live in `principal_role_assignments`. `principal.role` is a denormalized
  cache. (`packages/db/src/schema/rbac.ts`, `lib/shared/roles.ts`.)
- **Catalogue-driven permissions.** `packages/db/src/rbac-catalogue.ts` (categories: `workspace, members,
people, company, audience, feedback, changelog, help_center, survey, conversation, analytics,
integration, support, ai, status_page`). Adding a key = TS change + seed reconcile (`bun run db:permissions`), **no migration**.
- **System presets:** owner / admin / manager / **contributor** (`SYSTEM_ROLE_PERMISSIONS`). Contributor
  is a good base for tier agents.
- **Custom roles:** `domains/roles/role.service.ts` with grant ceilings (`assertWithinCeiling`,
  `assertGrantableRole`) and a plan cap `maxCustomRoles` (free/pro 0, business 5, **OSS/enterprise
  unlimited**).
- **Resolution:** `permissionsForPrincipal` (`policy/permissions.ts`) UNIONs permissions across a
  principal's assignments; empty → legacy preset. `requireAuth({ permission })` / `can(actor, perm)`
  enforce, but permissions are only attached on **dashboard** scope.
- **Dashboard gate:** `/admin` requires `role IN (admin, member)` + a dashboard session (`admin.tsx`
  `requireWorkspaceRole`), **then** permission checks. So dashboard access is the teammate flag first,
  permissions second.
- **Inbox/ticket scoping** uses **team membership** (`team_members`) + `conversation.view` vs
  `conversation.view_all`, not RBAC rows — which is why "tiers = teams" fits.
- **Portal/board/segment gating** scopes **end users**, not teammates (**team actors bypass** board and
  segment gates: `policy/boards.ts`, `policy/roadmaps.ts`).
- **Seats:** `type='user'` AND `role IN (admin, member)` consume a seat (`domains/principals/seat-usage.ts`)
  — **including all custom-role holders** (they ride `member`). Portal users and service principals are
  seat-free.

## 3. What works today with custom roles alone (no changes)

- **UX team** / **Dev team** as custom roles: e.g. grant `board.manage`, `post.set_status`,
  `post.set_board`, `post.set_tags`, `post.set_owner`, `post.edit`, `status.manage`, `tag.manage`,
  `roadmap.manage`, `suggestion.*` (dev-leaning), or a lighter UX bundle. They're `member` teammates.
- **Tier 1/2/3 agents** as custom roles over `conversation.*` / `ticket.*` (start from **Contributor**),
  combined with **teams** for queue routing (per the tiered-support plan). Tier permission _differences_
  (e.g. T1 `support.account.unlock` vs T2 `support.account.create` from the account-actions plan) are
  just different bundles.
- **Read-mostly stakeholders on the portal** (seat-free): private portal access + segments + board-access
  matrix already scope what they see, with no dashboard seat.
- **"Light admin"**: a custom role with a subset of Manager/Admin permissions.

## 4. Gaps → extensions (only build what you need)

| #   | Need (which persona)                                                                                                       | What stops it today                                                                                                                                                              | Extension                                                                                                                                                                 | Schema change?                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | **Multiple hats** — someone is _Dev team_ **and** _Tier 2_                                                                 | Schema allows multiple `(principal, role)` rows and resolution unions them, but the **writer replaces-all** (`reconcileWorkspaceAssignment`) and the members UI assumes one role | Add **assignment add/remove** APIs + multi-select UI; stop replace-all                                                                                                    | **No** (schema already supports it)                  |
| 2   | **Board/segment-scoped teammates** — Dev/UX/stakeholder limited to certain boards; tier perms only within their team       | RBAC is **workspace-wide**; team actors **bypass** board/segment gates; `principal_role_assignments.teamId` is **unused**                                                        | Wire **team-scoped RBAC** (read `teamId` in `permissionsForPrincipal`) and/or enforce **board-scoped** permissions for team actors                                        | **No** (columns exist; app-logic + enforcement)      |
| 3   | **Seat-free dashboard stakeholder** — view dashboards/analytics without consuming a teammate seat or gaining member powers | No middle tier between portal `user` and dashboard `member`; custom roles ride `member` → **consume a seat**                                                                     | Add a **non-seat access class** (e.g. legacy role `viewer`) with dashboard read + seat/gate updates — **or** keep stakeholders on the **portal** (recommended: no change) | **Small** (role enum + seat/gate logic) _if_ pursued |
| 4   | **Strict read-only (incl. no commenting)** & finer read keys                                                               | Dashboard commenting isn't permission-gated (team bypass); no `roadmap.view` / `post.view` / `comment.create` read keys                                                          | Add catalogue keys + gate the relevant server fns                                                                                                                         | **No** (catalogue + enforcement)                     |

Also additive: **new permission keys** these plans reference — `prioritization.manage` (already RESERVED),
`support.account.unlock` / `support.account.create` (account-actions plan) — pure catalogue additions.

## 5. Recommended approach per persona

- **Tier 1/2/3:** teams for routing (tiered-support plan) + custom-role bundles for capability (Contributor
  as base; T1 vs T2 differ by keys like `support.account.*`). Add **team-scoped RBAC (#2)** only if a
  person's tier powers must be limited to their team.
- **Dev team / UX team:** custom roles. Add **board-scoping (#2)** only if they must be restricted to
  specific boards (today teammates see all boards).
- **Stakeholders:**
  - **Default (no work):** portal private access + segments + board access — seat-free, scoped, exists today.
  - **If they need dashboard analytics/read:** either accept they're `member` seats with a read-only custom
    role (needs **#4** for true read-only incl. no comment), or build the **non-seat `viewer` class (#3)**.
- **People who wear multiple hats:** build **multi-role assignment (#1)**.

## 6. Phased extension plan (pick per requirements; each independently shippable)

| Phase                          | Deliverable                                                                                                                             | Trigger (only if…)                         | Validation                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| **0. Persona roles (no code)** | Create custom roles: "UX Team", "Dev Team", "Tier 1/2/3 Agent", "Stakeholder (read)"; assign                                            | Always — start here                        | Each role holds the intended keys; agents reach only permitted actions          |
| **1. New permission keys**     | Add `roadmap.view`, `post.view`, `comment.create` gate (+ enforce), plus reserved `prioritization.manage` / `support.account.*`         | You need finer/read-only gating            | Read-only role cannot comment/edit; seed reconcile passes                       |
| **2. Multi-role assignment**   | Add/remove assignment APIs (stop replace-all) + multi-select members UI                                                                 | People need combined hats                  | A principal holds Dev + Tier 2; permissions union correctly                     |
| **3. Team-scoped RBAC**        | Read `principal_role_assignments.teamId` in resolution; grant/UI for team-scoped roles; optional board-scoped enforcement for teammates | Personas must be board/team-limited        | Tier-2 power applies only within the Tier-2 team; dev sees only assigned boards |
| **4. Non-seat viewer class**   | New legacy role `viewer` (dashboard read, seat-free) + seat/count/gate updates                                                          | Stakeholders need seat-free dashboard read | Viewer reaches read dashboards, consumes no seat, cannot mutate                 |

Start with **Phase 0** (zero code) to validate whether custom roles alone meet the need before building 1–4.

## 7. Upgrade-safety

- Phase 0 and Phase 1 are **additive** (roles are data; permission keys are catalogue + seed reconcile).
- Phases 2–3 are **app-logic** on an existing schema (multi-row assignments and the reserved `teamId`
  already exist) — localized to `principal.factory.ts`, `policy/permissions.ts`, and the members/roles UI.
- Phase 4 is the only one touching the legacy role enum + seat predicates — scope it only if a seat-free
  dashboard persona is truly required (otherwise use the portal). All are strong upstream-contribution
  candidates since they extend the documented RBAC design rather than forking it.

## 8. Open questions

1. Which personas need **dashboard** access vs are fine on the **portal**? (Stakeholders especially —
   portal is seat-free and already scoped.)
2. Do any people need **multiple simultaneous roles** (e.g. dev + on-call Tier 2)?
3. Must **dev/UX/stakeholder** be limited to **specific boards** (board-scoped), or is workspace-wide fine?
4. Must **tier permissions** be **team-scoped** (only within their tier team) or workspace-wide?
5. Are **seat-free** dashboard stakeholders required (drives Phase 4), or is portal access acceptable?
6. Do you need **true read-only** on the dashboard including **no commenting** (drives Phase 1 comment gate)?
7. Should tiers be a first-class RBAC concept, or remain **teams + custom-role bundles** (recommended)?

## 9. File / seam index

- RBAC schema: `packages/db/src/schema/rbac.ts` (`roles`, `permissions`, `role_permissions`,
  `principal_role_assignments` incl. reserved `teamId`)
- Catalogue: `packages/db/src/rbac-catalogue.ts`; client mirror `apps/web/src/lib/shared/permissions.ts`
- Resolution/enforcement: `policy/permissions.ts` (`permissionsForPrincipal`), `policy/authorize.ts`
  (`can`), `functions/auth-helpers.ts` (`requireAuth`), `functions/workspace-utils.ts`
  (`requireWorkspaceRole`), `routes/admin.tsx` (dashboard gate)
- Role assignment writer: `domains/principals/principal.factory.ts` (`reconcileWorkspaceAssignment`,
  `setPrincipalRole`), `domains/principals/principal.service.ts` (`updateMemberRole`)
- Custom roles: `domains/roles/role.service.ts`, `role.ceiling.ts`, `role.grants.ts`
- Legacy role + team detection: `lib/shared/roles.ts` (`isTeamMember`); presets `presetForLegacyRole`
- Seats: `domains/principals/seat-usage.ts`, `seat-limit.ts`
- Resource gating (portal): `policy/boards.ts`, `policy/access.ts`, `policy/roadmaps.ts`,
  `schema/boards.ts` (`boards.access`), `schema/segments.ts`, `domains/*/portal-invites`
- Inbox/ticket team scoping: `policy/conversations.ts`, `policy/tickets.ts`, `team_members`
- Invites carrying custom roles: `functions/admin.ts` (`sendInvitationFn`), `functions/invitations.ts`

## 10. Relationship to other plans

- **Tiered support** (`docs/tiered-support-helpdesk-plan.md`): tiers = teams; this doc's Phase 3 (team-scoped
  RBAC) is what would let tier _permissions_ be team-scoped rather than workspace-wide.
- **Account actions** (`docs/support-account-actions-plan.md`): the new `support.account.*` keys and the
  T1/T2 role bundles are the Phase 0/1 deliverables here.
- **Multi-app control tower** (`docs/multi-tenant-control-tower-plan.md`): its fleet-admin identity is a
  **separate realm**; these workspace personas are per-app and unaffected by it.
