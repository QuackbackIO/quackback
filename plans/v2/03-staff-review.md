# Staff Engineer Review of the v2 Plans (2026-09-19)

> Reviewed against checkout `eb79147670c8872a456c2a0b817bcbaa4c626650`. **The full original review is
> [`REVIEW-2026-09-19.md`](REVIEW-2026-09-19.md)**; this page summarises it. The resolution of each finding is in
> each plan's "Staff-review changes" section and in `01-decisions.md` → "Raised by the staff review".

**Verdict:** the capabilities are achievable and the fork architecture can support continued upstream
upgrades, but the plans are not implementation-ready unchanged. Separate migration ledgers, sidecar tables,
fork-owned modules and a separate control tower are sound. Several integration contracts are incomplete or
incorrect, and keeping edits small does not by itself preserve upstream behaviour. The fork should promise **a
maintained, tested fork that can take upstream releases**, not conflict-free upgrades.

Severity: **P1** = fix before the affected feature ships; **P2** = resolve before committing its implementation
contract. These are design findings, not claims that unimplemented features are exploitable.

## Findings

| ID | Sev | Plan | Finding (summary) |
| --- | --- | --- | --- |
| F1 | P1 | 02, 20 | Fork migration lineage is not a complete production rollout: the Docker image copies only `packages/db/drizzle`; `fork-migrate` applies only SQL, so catalogue reconciliation (`seedSystemData`) never runs on fork-only releases; the runtime schema floor checks only the upstream ledger; suspended tenants miss fork catch-up. |
| R1 | P1 | 10 | The MCP permission map is tool-name only and cannot authorize argument-dependent tools (`triage_post` status vs owner) or dispatch branches (`search`/`get_details`). MCP resources check scopes only; `get_ticket` has no actor; REST service actors omit `permissions`; service principals bypass team row scope, so copying a creator's roles does not copy row scope. |
| C1 | P1 | 20 | Provisioned portals would default to **public** (`DEFAULT_PORTAL_CONFIG`: `visibility: 'public'`, `allowAnonymous: true`), contradicting D-N5. |
| C2 | P1 | 20, 10 | Role sync lacks assignment provenance, per-app Tier team mappings, preset-row reconciliation and fail-closed zero-role behaviour (a `member` with no assignments falls back to Manager). `canInTeam` must not read legacy `member` as Manager. Template sync is add-only. |
| C3 | P2 | 20 | Identity mapping (tower ↔ IdP/broker ↔ tenant user ↔ tenant principal) unspecified; portfolio expects tools plan 50 doesn't provide; Observer has `announcements.view` but tools need `announcement.manage`; sync authority (provisioner vs human MCP) ambiguous; no IdP revocation-delay bound. |
| T1 | P1 | 30 | Email-only requester claim calls `mergeLeadIntoUser`, which rejects leads without a `userId` — exactly the cold-email requester it targets. |
| T2 | P1 | 30 | Escalation is not idempotent or concurrency-safe: independent writes, idempotency row inserted last, no recovery, upstream writers not bound by a fork lock. |
| T3 | P1 | 30 | Ordinary routing/assignment paths (workflow `assign_team`, UI/API) bypass tier invariants and the ledger; auto-routing can be re-enabled; unpaired/manual tickets lack intake rules; `assignTicket` stamps `firstResponseAt`. |
| A1 | P1 | 40 | Account-action auth contradicts plan 10 (workspace-wide fallback vs team-only `canInTeam`); static `requireAuth({permission})` rejects team-only grants; ticket visibility not enforced on run/approve/cancel/resolve. |
| A2 | P1 | 40 | Direct break-glass run violates the proposed DB check (`requested_by = approved_by` for `break_glass`). |
| A3 | P1 | 40 | Malformed 2xx treated as `failed` → retry with a new idempotency key can repeat a destructive action; should be `unknown`. |
| A4 | P1 | 40 | Routing, identity binding and expiry notification lack durable recovery; identity read at execution, not bound at approval; cold-email requesters (`contactEmail`, no user) excluded. |
| P1 | P2 | 50 | Framework-switch semantics imprecise (dynamic vs switch-time invalidation; live vs frozen legacy scores; missing `compatibleWith` branch; mixed ordering); no stale-config save guard; no batch portfolio MCP contract; revenue-cache invalidation underspecified. |
| N1 | P2 | 60 | First-visit embed identity and long-lived refresh incomplete (null-principal viewer token, 12 h vs 5 min host token, logout/account switch). |
| N2 | P2 | 60 | Resolved-status banners read the wrong source (`activeIncidents` excludes resolved; `recentIncidents` windows by `startedAt`). |
| N3 | P1 | 60 | Announcement audit uses best-effort `recordAuditEvent`; must be transactional. |
| X-1 | — | 30 | Tier membership writes race upstream's replace-set team writer. |
| X-2 | — | 30, 40 | Tiers 1–9 in storage vs three Tier templates. |
| X-3 | — | 30 | "Read while watching" grants visibility only; the escalator keeps write capabilities. |
| X-4 | — | 02, 60 | Branding promise includes `customCss`/fonts; embed specifies variables + font family only. |
| X-5 | — | 50 | Mixed-framework sorting justified by labels the list surface doesn't show. |
| X-6 | — | all | Stale coordination notes; seam IDs out of sync with `SEAMS.md`; README wording on 🟡 items. |
| X-7 | — | all | Deferred scope must not be described as delivering the full capability set. |

## Upgrade practice required (from the review)

1. On each upstream upgrade, review changes to every used domain contract, role resolver, assignment writer,
   auth flow and FK target — including unchanged seam call sites whose callees changed.
2. Regenerate structural snapshots, then run negative authorization and feature contract tests.
3. Rehearse an empty install **and** an upgrade of a populated fork database, including fork-only releases,
   old-code/new-schema operation, suspended tenants and failure recovery.
4. Gate deployment on image contents, both migration ledgers, catalogue seeding and workspace isolation. Give
   each seam/contract an owner and a test.

## Validations still required (not completed)

AWS RDS Proxy prepared statements / DSN-OID checks / capacity; shared S3 via the registry provider shape;
mail-edge signing/routing/retry; real OIDC + SAML-broker login, no-consent OAuth, token rotation, connect-all
recovery; private-portal and help-center/Ask-AI negative access tests; tier/account-action crash recovery and
concurrent writers; score SQL/TS parity and sort performance; banner SSE load, limiter fallback, token lifecycle.

## Resolution tracking

See each plan's **"Staff-review changes"** section and `01-decisions.md` → "Raised by the staff review".
