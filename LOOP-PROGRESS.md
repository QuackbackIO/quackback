# First-customer Loop Progress

Lead: Codex `/root`  
Taken over: 2026-08-14  
Workspace branch: `saas`  
Control-plane branch: `saas`

## Governing correction

The control plane is now the sole billing authority. Earlier workspace-owned
provider work and the workspace `BILLING_PRICES.pro.limits` direction are
superseded and will be removed after the gateway and signed projection path are
in place. Existing direct-billing live evidence demonstrates provider behavior
only; it does not close the new architecture tracks.

## Current revisions

- Workspace: `0201c6327`
- Control plane: `f52750b`
- Last known deployed workspace: `03ea102e` (2026-08-14)
- Last known deployed control plane: `01d3e028` (2026-08-14)

No deployment has yet been made for the revised billing ownership model.

## Tracks

| Track                            | Status                                   | Evidence                                                             |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| 0 contextual activation          | implemented, focused verification passed | `d2b8accca`, `029727e26`                                             |
| 1 owner handoff + starter        | implemented, focused verification passed | app `9f0ff90e8`, `31b07cf03`; CP `957beda`                           |
| 2 focused widget activation      | implemented, focused verification passed | `13df888fa`                                                          |
| 3 CP billing foundation          | not started under revised boundary       | CP catalogue/ledger/gateway/projection required                      |
| 4 workspace projection + gateway | in progress                              | uncommitted projection consumer replaces `2c3923ba9` catalogue reads |
| 5 authoritative starter trial    | not started                              | workspace still calls local trial start and must change              |
| 6 remove workspace billing       | not started                              | direct provider integration remains                                  |
| 7 PLG + first-win proof          | in progress                              | typed privacy-safe event work uncommitted                            |

## Completed activation work

- Pure contextual action selector and one-primary-action surfaces.
- Outcome-specific launch tasks and optional polish.
- Public-board link milestone and copy fallback.
- Focused widget/Messenger installer with atomic channel configuration.
- Goal-only provisioned onboarding and tailored starter handoff.
- Owner-bound, one-use OTT handoff with fail-closed workspace handling.

## Current worktree ownership

The workspace worktree contains two intentionally uncommitted units:

1. typed allowlisted PLG events and call-site instrumentation; and
2. replacement of workspace catalogue-derived trial limits with a local billing
   projection model.

Before committing, separate those units by explicit path and ensure the
workspace-local `trial_started` event is removed; that event becomes
control-plane-authoritative.

The control-plane worktree was clean at takeover. Re-check before every edit and
commit because another agent shares the codebase.

## Next commits

1. `docs(saas): make control-plane billing authoritative`
2. `feat(analytics): add privacy-safe activation events`
3. `feat(billing): consume versioned control-plane projections`
4. Control-plane catalogue/readiness/projection primitives.
5. Control-plane starter activation and signed fan-out.
6. Workspace projection ingestion and billing gateway actions.
7. Delete workspace provider integration and obsolete configuration.

## Verification still required

- Projection signature, monotonicity, replay, and stale update tests.
- Least-restrictive numeric limit overlay and exact-expiry tests.
- Cross-workspace checkout/portal isolation.
- Control-plane webhook replay and outbox retry.
- Created/configured-only trial activation and immutable anchor.
- Control-plane outage behavior for normal use and billing actions.
- Fresh-browser journeys for every onboarding outcome and self-hosted mode.

## Blockers

None. The revised boundary requires paired control-plane and workspace changes
before the next deployment.

## Historical live evidence

The prior direct-workspace test-mode checkout, expiry, and self-host probes passed.
Those provider keys, catalogue variables, workspace webhook route, and provider
references are now migration debt, not the target architecture.

Disposable `walk-*` resources from the earlier loop remain listed in the old
untracked ledger outside the implementation worktree. Do not delete them without
fresh registry checks and explicit in-scope cleanup work.
