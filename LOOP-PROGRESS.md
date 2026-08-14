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

- Workspace: `0201c6327`
- Control plane: `f52750b`
- Last known deployed workspace: `03ea102e` (2026-08-14)
- Last known deployed control plane: `01d3e028` (2026-08-14)

No deployment has yet been made for the revised billing ownership model.

The prior web deployment `03ea102e` runs image digest `sha256:596d77e3…` in
`us-east4-eqdc4a`. Worker, cron, and migrator services remain on the older
`sha256:8ff95109…` pin. A future paired rollout must move all roles deliberately.

## Tracks

| Track                            | Status                                        | Evidence                                                |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| 0 contextual activation          | implemented, focused verification passed      | `d2b8accca`, `029727e26`                                |
| 1 zero-input create + identity   | handoff/starter done; new identity scope open | app `9f0ff90e8`, `31b07cf03`; CP `957beda`              |
| 2 focused widget activation      | implemented, focused verification passed      | `13df888fa`                                             |
| 3 CP billing foundation          | not started under revised boundary            | CP catalogue/ledger/gateway/projection required         |
| 4 workspace projection + gateway | projection consumer implemented               | `7d18b3cea`, `9eb85a9e6`; gateway actions remain        |
| 5 authoritative starter trial    | not started                                   | workspace still calls local trial start and must change |
| 6 remove workspace billing       | not started                                   | direct provider integration remains                     |
| 7 PLG + first-win proof          | infrastructure implemented                    | `33c15ba53`; first-win journeys remain                  |

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

The workspace worktree is clean. Projected limits and signed monotonic ingestion
are committed. Workspace-local `trial_started` emission was deliberately
excluded because that event becomes control-plane-authoritative.

The control-plane worktree was clean at takeover. Re-check before every edit and
commit because another agent shares the codebase.

## Next commits

1. Control-plane catalogue/readiness/projection primitives.
2. Control-plane starter activation and signed fan-out.
3. Control-plane zero-input identity model, gateway, and projection.
4. Workspace post-handoff identity UI and cloud Settings gateway.
5. Control-plane Cloudflare for SaaS custom-hostname integration.
6. Workspace billing gateway actions.
7. Delete workspace provider integration and obsolete configuration.

## Verification still required

- Projection signature, monotonicity, replay, and stale update tests.
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
