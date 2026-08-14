# First-customer Loop Progress

Lead: Codex `/root`  
Taken over: 2026-08-14  
Workspace branch: `saas`  
Control-plane branch: `saas`

## Governing correction

The control plane is now the sole billing authority. Workspace provider
integration and billing tables are already gone from the live image
(`178f0bf9b`, `0261`). Remaining `BILLING_*` service variables are unused
migration debt. Existing direct-billing live evidence demonstrates the old
provider path only; it does not close the new architecture tracks.

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

- Workspace: `b1a34ab7b` (deployed image remains `58eebd173`)
- Control plane: `e2219f5` (live deploy remains `14dee7a2` / `b4afe73`)
- Last known deployed workspace: `58eebd173` (2026-08-14)
- Last known deployed control plane: `14dee7a2` (2026-08-14)

The Development fleet now runs a paired image/code pair for identity and
billing-ownership work. Fresh-browser onboarding/rename journeys are still
required before the revised tracks can close.

Workspace image `ghcr.io/quackbackio/quackback@sha256:496d295f1d87bf71e82e3f26913b9954a8ffde530f90242769ad9592aca44f30`
was published from Docker workflow `31809268242` at commit `58eebd173`.
Verified `meta.imageDigest` matches on web `4394da8d`, worker `b5646929`,
cron-hourly `45979b99`, cron-daily `6bb7b221`, and migrator `e3709ae4`.
Web remains in `us-east4-eqdc4a`. Cron-daily was moved off `sfo` onto
`us-east4-eqdc4a`. Control plane `14dee7a2` remains the live `sfo` build of
`b4afe73`.

That control-plane deploy had not applied SQL `0063`–`0067`. The live control
database still had `tenant_hostname_kind` as `subdomain`/`custom` and
`cp_instances.subdomain`. Those five migrations were applied with
`railway run … bun run db:migrate` against the control-plane service;
the enum is now `system`/`platform`/`platform_redirect`/`custom` and
`system_hostname` replaced `subdomain`.

Workspace schema target `0262_cloud_identity_projection` was then set and
reconciled. Seven walk workspaces applied cleanly. Gauntlet `t1`/`t2` refused
until `--allow-mutating-replay` because a gapped ledger would replay
`0260_sending_domain_reverify`; those two databases had no sending-domain
rows, so the replay was a no-op. All nine enrolled workspaces now report
`succeeded` at `1786723200000` with 238 ledger rows and
`postconditions_ok`. Walk hosts still 307 to `/?sort=trending`.
`MIN_SCHEMA_VERSION` remains `0258_workspace_key_columns`.

The migrator cron (`47 2 * * *`) and `enrol && run` start command were
restored after the one-shot runs. No diagnostic build-command override
remains.

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
| 6b remove stale SaaS code        | first slice deleted; remainder pending                                   | CP `e2219f5`                                                        |
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

Both worktrees were clean after workspace commit `58eebd173` and control-plane
commit `b4afe73`. The workspace
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
real-Postgres onboarding fixture is still pre-0262 and therefore correctly
skips 13 tests. Development Neon workspaces are now at 0262; unskip those
tests only after the local fixture is migrated.

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

1. Finish the stale-code pass. First slice: CP `e2219f5` deleted
   `domain-multi-fn`, `members-fn`, `org-billing-fn`, `domains/multi.ts`,
   and their tests (2,637 lines). Typecheck passed; Vitest 201 files /
   2,607 tests passed, 21 skipped. `org-subscription` and the domain
   verify sweeper stay because provision/webhooks/reconcile still use
   them. Remaining inventory is below.
2. Finish separating `cp_instances.name` from the authoritative identity
   projection. New creates still write `Untitled workspace` into that
   column; display name lives on `cp_workspace_identity`. Do not use
   `cp_instances.custom_domain*` for the new path.
3. Add database-backed rename-transfer replay/expiry/wrong-workspace and stable
   asset-origin verification.
4. Fresh-browser prove the deployed identity pair on **new** generated
   `ws-*.quackback.co.uk` hosts: zero-input create, OTT handoff, skippable
   details, rename transfer. Do not use existing `walk-*` rows; they have
   no identity or hostname-claim rows (13 instances, 0 identity, 0 claims).
   Do not backfill their old customer-facing names into the identity ledger.
5. Add the control-plane Cloudflare for SaaS custom-hostname integration.
6. Add the shared workspace custom-domain manager on
   `cp_workspace_hostname_claims`, then live-prove hostname and certificate
   readiness before enabling it.
7. Run the remaining control-plane billing gateway and first-win journeys.
   Checkout attaches to an existing workspace only.

## Stale code to remove

No Railway/Neon/Cloudflare SaaS compatibility with the previous create,
billing, or custom-domain paths. Delete rather than gate. **Self-host
(`settings.cloud` absent / `enabled: false`) stays:** local workspace
name, local Help Center reverse-proxy domain, no Plan & billing nav, no
cloud URL/domain controls, Stripe remains a customer integration.

### Delete on the control plane

- ~~`domain-multi-fn.ts` / `domains/multi.ts`~~ deleted in `e2219f5`.
  `domains/mutator.ts`, `verify.ts`, and the domain-verify sweeper
  remain until reconcile stops reading `cp_instance_domains`.
- ~~`org-billing-fn.ts`~~ deleted in `e2219f5`. Keep
  `org-subscription.ts` — provision, plan changes, and webhooks still
  call it. Live customer checkout is `workspace-gateway.ts`.
- ~~`members-fn.ts`~~ deleted in `e2219f5`. Keep `accept-invite-fn`.
- Customer dashboard leftovers that only redirect:
  `dashboard/$orgId/billing`, `.../members`, `.../settings*`. Remove once
  no mail template still points at them, or keep as redirects with a
  delete-by date.
- `setup.$orgId.tsx` header still describes a Name form. The page
  auto-creates. Delete the named-create copy and any unused wizard name
  fields.
- `cp_instances.name` as customer identity; `custom_domain`,
  `custom_domain_verified`, `custom_domain_verified_at`; unread
  `r2_bucket_name`, `r2_token_id`, `oidc_client_id`. Drop after no
  replica SELECTs them.
- `login_url` / magic-link owner door if Open+OTT is the only customer
  handoff. Confirm bootstrap email before deleting.
- `stripe_subscription_item_id`, `pending_plan_id`,
  `cancel_at_period_end_at` on instances if workspace billing no longer
  writes them.
- Admin `plan-fanout` and any operator path that still provisions by
  customer name/URL.

### Delete on the workspace app / fleet

- `apps/web/src/lib/server/domains/billing/provider/` if empty or still
  holding provider clients. Platform billing is projection + CP gateway
  only.
- Railway web/worker/cron/migrator variables `BILLING_API_KEY`,
  `BILLING_PRICES`, `BILLING_WEBHOOK_SECRET` (still present on the live
  web service). They are not read by the deployed image.
- Workspace webhook still targeted at `walk3-mss0m53h` in the Stripe
  test catalogue. Retire that endpoint; do not reattach it to the app.
- Local onboarding fixture still pre-0262 (13 skipped tests). Migrate
  or replace the fixture; do not keep a pre-identity schema for SaaS
  tests.

### UI must stay hidden when cloud is off

Already: Plan & billing only when `billingEnabled`; General uses local
name when there is no identity projection; onboarding name form only
when `!isCloudProvisioned`.

Audit and fix if any of these render without a verified cloud
projection: friendly Quackback URL, custom-domain card, commercial
trial banner, upgrade/change-plan CTAs, control-plane identity errors
on self-host.

### Do not delete

- Self-host onboarding workspace name (`_layout.workspace.tsx` when
  `!isCloudProvisioned`).
- `updateWorkspaceNameFn` for local `settings.name`.
- Help Center reverse-proxy domain helpers (`help-center-domain.ts`).
- Product Stripe integration (`apps/web/src/integrations/stripe/**`).
- Contextual activation, focused widget installer, projection
  consumption, instance-scoped billing/identity gateways.

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
  provider retry, and cross-workspace isolation. Not a Track 1 close
  requirement.

## Blockers

None. The identity/billing pair is already deployed. Further deploys are
incremental after the current Track 1 unit.

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
