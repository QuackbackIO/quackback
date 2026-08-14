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

Workspace creation and cloud identity are also control-plane-owned. The first
workspace must now be created immediately after control-plane sign-in with
generated immutable identifiers and no name, URL, region, or plan form. Name,
friendly platform URL, and custom domains move into skippable post-handoff and
Admin Settings UI; cloud mutations traverse the instance-scoped control-plane
client and return as signed monotonic identity projections.

Development infrastructure supports registry-only platform URL changes: the
live Railway web service owns `*.quackback.co.uk`, Cloudflare is authoritative
DNS, and the wildcard CNAME reaches that one pooled service with a matching
wildcard certificate. Arbitrary customer domains are not covered by that
certificate. The existing control-plane ownership verifier and registry writer
therefore remain incomplete until a control-plane-owned Cloudflare for SaaS
Custom Hostnames integration proves both hostname and SSL readiness.

## Current revisions

- Workspace: `ff19faf4c`
- Control plane: `b4afe73`
- Last known deployed workspace: `03ea102e` (2026-08-14)
- Last known deployed control plane: `14dee7a2` (2026-08-14)

No complete paired deployment has yet been made for the revised billing
ownership model.

Control-plane deployment `14dee7a2-6a01-44ea-ba39-da7c2abd93bf` is a fresh
Railway build of `b4afe73` and reached SUCCESS in `sfo`. The attempted paired
workspace rollout did not advance the image: deployments `7cb1c890`,
`53a53727`, `79d21f7e`, `3d8afed5`, and `2f810f9d` all reached SUCCESS but
reused the prior `sha256:596d77e3…` web image or `sha256:8ff95109…` role image.
They are explicitly not accepted as deployment proof for `8ae498796`.
Railway service configuration remains image-based with the prior commands,
cron schedules, and regions; no diagnostic build-command override remains.

The prior web deployment `03ea102e` runs image digest `sha256:596d77e3…` in
`us-east4-eqdc4a`. Worker, cron, and migrator services remain on the older
`sha256:8ff95109…` pin. A future paired rollout must move all roles deliberately.

## Tracks

| Track                            | Status                                                                   | Evidence                                                            |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 0 contextual activation          | implemented, focused verification passed                                 | `d2b8accca`, `029727e26`                                            |
| 1 zero-input create + identity   | implementation complete through post-handoff details; live proof pending | CP `bd9148c` through `9071f83`; app `4a1827560` through `ff19faf4c` |
| 2 focused widget activation      | implemented, focused verification passed                                 | `13df888fa`                                                         |
| 3 CP billing foundation          | implemented; full/live verification pending                              | CP `c7ec591` through `9f77647`                                      |
| 4 workspace projection + gateway | implemented; full/live verification pending                              | app `7d18b3cea`, `9eb85a9e6`, `3004486a6`                           |
| 5 authoritative starter trial    | implemented; full/live verification pending                              | CP `2fa8a08`, `710ab09`; app `3004486a6`, `4688afa92`               |
| 6 remove workspace billing       | implementation complete; boundary scan pending                           | app `178f0bf9b`, `3908c1031`; CP `8cb9738`, `3bb1c37`               |
| 7 PLG + first-win proof          | infrastructure implemented                                               | `33c15ba53`; first-win journeys remain                              |

## Completed activation work

- Pure contextual action selector and one-primary-action surfaces.
- Outcome-specific launch tasks and optional polish.
- Public-board link milestone and copy fallback.
- Focused widget/Messenger installer with atomic channel configuration.
- Goal-only provisioned onboarding and tailored starter handoff.
- Owner-bound, one-use OTT handoff with fail-closed workspace handling.

## Historical live bar already passed

Before the billing-ownership correction, two fresh-mailbox handoff walks and a
test-mode hosted checkout passed on the Development fleet. The plan picker named
prices, a paid Growth subscription replaced trial access, exact trial expiry
fell to Free without breaking sign-in or existing data reads, forged webhook
signatures failed closed, and self-host commercial-chrome tests passed. Repeat
this through the control-plane gateway before closing the revised billing tracks.

## Current worktree ownership

Both worktrees were clean after workspace commit `ff19faf4c` and control-plane
commit `9071f83`. The workspace
accepts only signed control-plane commercial projections and contains no
platform billing provider integration. The control plane now owns catalogue,
gateway, starter trial, webhook projection, and durable fan-out behavior. Its
obsolete organisation trial conversion and expiry-suspension paths were removed
in `8cb9738` and `3bb1c37`. Creation and restore no longer use that trial policy
after `6b68ced`.

Control-plane `bd9148c` derives opaque immutable provisioning identifiers from
the instance id. `41b277d` makes the customer creation contract zero-input apart
from an idempotency key, auto-starts the first workspace from the dashboard,
uses generated identity and default placement, and gives later Create workspace
clicks their own durable intent. The database-enforced creation key converges
refreshes, response-loss retries, queue-submission retries, and concurrent tabs.
Focused creation/setup verification passed: 53 tests and control-plane
typecheck.

The control plane now has a distinct signed identity-projection ledger and
outbox, explicit immutable-system/platform/redirect routing kinds, and an
instance-credential-scoped identity gateway. Friendly renames reserve names
permanently, update registry origin atomically, and turn an earlier friendly
hostname into redirect-only routing. Initial projections correctly leave the
friendly platform hostname null rather than presenting the immutable system
alias as mutable customer identity. Focused identity verification passed: 38
tests and control-plane typecheck.

The workspace verifies and monotonically applies the separate identity stream,
redirects safe requests away from obsolete hosts without opening a tenant
database, transfers the current owner session across a rename, and exposes
cloud identity only when a verified projection exists. Admin Settings and the
post-handoff details step use the instance-scoped gateway; self-hosted setup
retains local name editing and makes no identity-gateway call. Cloud onboarding
now has an optional details screen followed by the outcome screen, with one
primary action on each. Focused onboarding UI/state verification passed: 54
tests across the latest slices; the full workspace typecheck passed. The local
real-Postgres onboarding fixture is stale before migration 0262 and therefore
correctly skips 13 tests; the Development Neon migration is still required.

The old operator/admin/MCP workspace-creation surfaces are deleted. Control-plane
commits `4e730be`, `e69d48f`, and `a39a8c5` removed the manual admin dialog,
provision token route, CLI trigger, MCP creation tool, and its private capacity,
plan, hostname-claim, and insert machinery. `bb4f7e9` renamed the physical
immutable column and retention key from `subdomain` to `system_hostname`.
`9071f83` then removed the bare-label/full-hostname compatibility layer entirely:
system hostnames have one fully-qualified representation, every provisioning,
bootstrap, health, registry, open, and MCP path consumes that exact value, and
the MCP context no longer carries a base domain for canonicalization. Control-
plane typecheck and the complete suite passed after the cut: 207 files and 2,711
tests passed, with 5 files and 21 tests intentionally skipped.

Control-plane `b4afe73` removed the last checkout-created-workspace path. Stripe
metadata can no longer insert or provision a workspace, the browser checkout-
success route and webhook finalizer are gone, missing instance references fail
closed, and the remaining checkout reducer only links commercial state to an
existing workspace. The production build and client-bundle audit passed; the
full control-plane suite passed 207 files and 2,696 tests, with the same 5 files
and 21 tests intentionally skipped.

Re-check both worktrees before every edit and commit because another agent shares
the codebase.

## Next commits

1. Finish separating `cp_instances.name` from the authoritative identity
   projection.
2. Add database-backed rename-transfer replay/expiry/wrong-workspace and stable
   asset-origin verification.
3. Deploy and prove the compatible control-plane/workspace identity pair in
   Development, including migration 0262 and fresh-browser onboarding/rename.
4. Add the control-plane Cloudflare for SaaS custom-hostname integration.
5. Add the shared workspace custom-domain manager, then live-prove hostname and
   certificate readiness before enabling it.
6. Run the remaining control-plane billing gateway and first-win journeys.

## Verification still required

- Rename transfer replay, expiry, and wrong-workspace database tests.
- Least-restrictive numeric limit overlay and exact-expiry tests.
- Cross-workspace checkout/portal isolation.
- Control-plane webhook replay and outbox retry.
- Created/configured-only trial activation and immutable anchor.
- Control-plane outage behavior for normal use and billing actions.
- Fresh-browser journeys for every onboarding outcome and self-hosted mode.
- Zero-input first-workspace creation and retry after interrupted provisioning.
- Cloud URL collision, rename handoff, old-host redirect, and stable asset-origin
  behavior.
- Custom-domain ownership, DNS, hostname/SSL readiness, make-primary, removal,
  provider retry, and cross-workspace isolation.

## Blockers

None. The revised boundary requires paired control-plane and workspace changes
before the next deployment.

Operational defects carried from the prior lead:

- The control-plane purge sweep logs `deprovision.failed` and needs diagnosis.
- `cp-t2crit.quackback.co.uk` has been stranded in `provisioning` since
  2026-08-09; its former probe bucket was deleted after registry checks.
- The control plane still requires Redis for rate limiting.

## Historical live evidence

The prior direct-workspace test-mode checkout, expiry, and self-host probes passed.
Those provider keys, catalogue variables, workspace webhook route, and provider
references are now migration debt, not the target architecture.

Disposable workspaces still running from the earlier loop:

- `walk-msrx530c`, `walk1-msrxt17d`, `walk2-msryvgqj`, `walk3-mss0m53h`;
- `walk-msscrita`, `walk-msscritb`, `walk-critic-m6qkz`;
- `walk-critic-a1` and `walk-critic-b1`.

Do not delete them without fresh registry checks and explicit in-scope cleanup
work. `walk3-mss0m53h` is also the target of the obsolete workspace-side fleet
webhook and must remain until that integration is removed or deliberately
retired.
