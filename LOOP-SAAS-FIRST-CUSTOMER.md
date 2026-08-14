# Loop: First SaaS Customer

This is the lead-agent runbook for completing one first-customer journey on the
two `saas` branches.

## /loop

In a new Grok session, paste this and send it. `/loop` is the scheduler;
`/saas-first-customer` loads `LOOP-PROMPT.md`.

```
/loop 30m /saas-first-customer
```

It fires immediately, then every 30 minutes, until done or a stop-and-ask.
Do not paraphrase `LOOP-PROMPT.md` into a new mission.

## Worktrees

| Boundary      | Path                                  | Branch |
| ------------- | ------------------------------------- | ------ |
| Workspace app | `/home/james/quackback-wt/saas-merge` | `saas` |
| Control plane | `/home/james/quackback-cp`            | `saas` |

Commit small, coherent changes directly to the relevant `saas` branch. Before
each commit, inspect the worktree and stage explicit paths so concurrent work is
not included. Do not create a piece branch, change `main`/`next`, or add
co-author trailers.

## Customer outcome

A new SaaS owner can:

1. receive a generated workspace immediately after control-plane sign-in,
   without supplying a name, URL, region, or plan;
2. open it through a single-use handoff without authenticating again;
3. set a display name and a required friendly cloud URL inside the
   workspace (the generated system host is never shown as the address);
4. answer the outcome question;
5. receive a useful starter artifact;
6. follow one outcome-specific primary action;
7. begin a 14-day Pro trial only after the starter is created or configured;
8. upgrade, change plan, downgrade, cancel, and update a card from
   workspace Plan & billing (control-plane checkout or portal);
9. keep using the product from the latest local billing projection during a
   temporary control-plane outage, with Free as the baseline and named
   limit/entitlement refusals;
10. own up to three live Free workspaces at a time, and unlimited paid
    workspaces. The count is per signed-in owner, not per organisation;
11. transfer ownership, leave, switch workspaces from inside the
    product, see usage before a limit 402, and export or wipe data /
    delete the control-plane account when they have no live workspaces.

Product-feedback owners are never required to install the widget. Customer
support owners receive the focused Messenger installation flow. Help Center and
internal-feedback owners receive their own tailored continuation.

## Non-negotiable boundaries

- Railway compute, Neon database-per-workspace, and Cloudflare routing remain.
- Cloud capability is explicit; it is never inferred from a hostname.
- Self-hosted workspaces have no commercial trial, billing CTA, or dependency on
  the control plane.
- The control plane owns every provider integration and all authoritative
  commercial state.
- Workspaces own the in-product UX and locally enforce signed projections.
- No provider key, webhook secret, provider id, token, or price catalogue is
  stored in a workspace.
- A workspace authenticates to the control plane with its instance credential;
  billing and cloud-identity APIs never accept a workspace id as authority.
- Cloud display name, friendly platform URL, and customer domains are
  control-plane-owned and projected back to the workspace; the workspace owns
  their in-product presentation.
- Immutable provisioning identifiers are never derived from a mutable customer
  name or friendly URL.
- Self-hosted workspaces edit their name locally and never render or call cloud
  URL/domain management.
- Return URLs come from the control-plane registry and an allowlist.
- Trial end is a clock-based fallback to the projected Free state, not a
  suspension.
- First-win invitations are optional except for the explicit
  internal-feedback outcome. Invite / remove / change-role still exist
  as hosted account operations and honour Free seat limits.
- Branding and integrations are always optional polish.
- A seat is a workspace teammate (admin/member with a login), not a
  portal user. Paid cloud plans do not cap seats in this loop.
- Soft-deleted workspaces are not live. Restore of a Free workspace
  re-checks the three-Free cap.

## Wake-up protocol

At the start of each work period:

1. Read this file, `SAAS-HOSTING-STACK.md`, and `LOOP-PROGRESS.md`.
2. Inspect status and recent commits in both worktrees.
3. Preserve concurrent uncommitted work and identify the first incomplete track.
4. Finish, test, and commit one coherent unit before starting another.
   The orchestrator may run up to three named lanes at once (see
   LOOP-PROMPT.md Safe concurrency). Fleet deploys stay single-threaded.
5. Spawn a fresh critic on each completed unit (goal, bar, commit range, live
   URLs only). Record the verdict. A unit is builder then critic.
6. After the unit (or when no unit is in flight), run the hosted-product
   sweep in `LOOP-VERIFY.md`. Spawn a Fixer only for HIGH SIGNAL findings
   that are not stop-and-ask.
7. Update `LOOP-PROGRESS.md` with the commit, verification evidence, and
   critic verdict.
8. Deploy only when the app/control-plane pair is compatible and focused tests
   are green. Track 8 (hosted account operations) is additional in-scope
   work, after the 3-Free deploy, not a new architecture.

### Deployment mechanics verified on 2026-08-14

- `docker.yml` builds `saas` only through `workflow_dispatch`.
- After changing `source.image`, use `serviceInstanceDeployV2`.
  `serviceInstanceRedeploy` reuses the prior deployment image.
- Verify the deployed image digest rather than trusting the configured source.
- Redeploys have drifted the web service back to `sfo`; reassert and verify the
  `us-east4-eqdc4a` region pin.
- The committed Railway file was not applied during the earlier loop. Inspect
  the complete destroy list before any future apply.

## Tracks

### Track 0: Contextual activation

Outcome: every activation surface has at most one primary CTA and it matches the
selected outcome.

- Feedback: create public board, then copy its link, then informational only.
- Customer support: connect Messenger, then open the observed site, then
  informational only.
- Other conversation goals: informational only, with no widget CTA.
- Launch plan: one prominent next-step card, compact required status, collapsed
  optional polish.
- New task ids only; replaced task implementations may be removed.
- Public-board link copy is a validated, idempotent activation milestone.

Bar: contextual selector tests cover every state, and empty-state tests prove no
surface renders more than one primary action.

### Track 1: Zero-input creation, owner handoff, and cloud identity

Outcome: the control plane creates the first workspace immediately after sign-in
using generated immutable identity. When bootstrap succeeds, the setup
page auto-opens the workspace through a ten-minute, owner-bound,
single-use OTT. The control-plane dashboard is not a pre-handoff step.
There is no pre-handoff name, URL, region, or plan form.

After handoff, Workspace details requires a display name and a friendly
Quackback URL before the goal question. The generated system host is not
shown or prefilled. The same name/URL controls live in Admin Settings →
General. Custom domains use a workspace Domains surface on the same
identity gateway once the hostname provider is live. The workspace UI
calls an instance-scoped control-plane identity gateway; the control
plane atomically reserves hostnames, owns canonical registry state, and
fans a signed monotonic identity projection back to the workspace.

Platform URL changes retain immutable database, namespace, mail, storage, and
system-host identities; every old friendly host remains permanently reserved as
redirect-only and the browser crosses to the new canonical host through a
single-use current-principal handoff.

Customer custom domains are **not** part of this track’s close bar. They wait
for a control-plane Cloudflare for SaaS integration. Do not add a competing
Custom domains card, and do not revive `cp_instances.custom_domain*`. New
identity uses `cp_workspace_hostname_claims`. The cloud Help Center must reuse
that manager once it exists; the self-host reverse-proxy path stays local.

Bar: tests cover zero-input create/retry, generated-identifier immutability,
concurrent friendly-URL claims, reserved names, signed projection
replay/staleness, control-plane outage, rename session transfer, redirect-only
old hosts, host-independent stored asset refs (leaves absolutize from
the system host), and self-host absence. Fresh-browser
tests cover OTT success, replay, expiry, wrong workspace, and sign-in-only
behavior for non-owners. Custom-domain add/verify/make-primary/remove is a
later bar.

### Track 2: Focused widget activation

Outcome: `/admin/settings/widget/install` atomically enables the selected mode,
offers the minimal SDK snippet, polls installation observation every five
seconds, and then shows the verified hostname and outcome-specific next action.

The general Widget page contains only a compact status card. Identification of
signed-in visitors and developer instructions are secondary actions.

Bar: tests cover atomic Messenger/feedback configuration, polling, verified
hostname, and absence of settings-page loops.

### Track 3: Control-plane billing foundation

Outcome: the control plane contains the validated catalogue, billing ledger,
provider clients and webhooks, instance-scoped checkout/portal gateway, immutable
trial eligibility, projection signing, and an outbox-backed fan-out.

Bar:

- startup rejects a cloud billing deployment without valid Pro trial limits or
  signing configuration;
- instance credentials cannot act for another workspace;
- return URLs cannot be supplied by callers;
- webhook and starter-event replays are idempotent;
- provider data never appears in projection payloads;
- `GET /api/v1/internal/billing/catalogue` returns advertised stickers
  (same as the public pricing page; annual = ten months) with no
  provider ids;
- `GET /api/v1/internal/billing/invoices` returns hosted invoice URLs
  for this instance only.

### Track 4: Workspace projection and gateway

Outcome: a workspace verifies signed projections, atomically accepts only a
higher version, caches the latest projection, and uses it for UI and enforcement.
Upgrade, Change plan, and Manage billing proxy to the control plane and return a
303 to its hosted URL. Downgrade, cancel, and update-card use the same
portal session. Free is the projected baseline; numeric limits and
entitlements refuse with a named plan; a paid overlay lifts them.

The Plan & billing page is a compact settings surface: current subscription
strip, four plan cards from the **control-plane catalogue** (prices,
highlights, add-ons — same stickers as the public pricing page), monthly /
annual toggle, and an invoices table. The workspace does not keep a parallel
price list. Invoices are listed through the instance-scoped CP API (hosted
invoice URLs only; the workspace never stores provider ids).

Bar:

- invalid signatures and stale versions are rejected;
- repeated versions are idempotent;
- active trial and paid limits overlay in the least-restrictive direction;
- `now >= expiresAt` falls back exactly to projected Free limits;
- a control-plane outage preserves existing access and makes billing actions
  retryable;
- self-host remains on its existing limits path;
- Plan & billing renders catalogue cards + invoices from those GETs,
  not a local price list. Paid workspaces change plan through portal
  until checkout accepts an existing subscription.

### Track 5: Authoritative starter activation

Outcome: `created` and `configured` starters emit idempotent activation evidence
to the control plane. The control plane stamps the trial once and fans the new
projection. `deferred`, `unavailable`, and provisioning never start a trial.

Bar: tests prove all resolutions, immutable retry behavior, valid evidence,
projection delivery, `trial_started` structured logging, and exact expiry.

### Track 6: Remove workspace billing ownership

Outcome: workspace provider clients, provider routes/webhooks, catalogues,
secrets, provider references, and authoritative subscription logic are deleted.
Documentation and deployment configuration contain none of them.

Bar: source/config scans enforce the boundary, workspace typecheck and tests are
green, and control-plane checkout/webhook/projection integration works in test
mode.

The live image already dropped the billing tables (`0261`). Remaining work is
the scan plus Railway `BILLING_*` variables and the walk3 fleet webhook.

### Track 6b: Remove stale SaaS-incompatible code

Outcome: the Railway/Neon/Cloudflare SaaS paths contain only the current
create, identity, and billing contracts. Old named-create, k8s custom-domain,
org-level customer billing UI, and CP member-roster code is deleted, not
gated. Self-host with cloud off is unchanged and shows none of those
surfaces.

Priority: do this before building Cloudflare custom domains or more billing
UI, so nobody implements on `domain-multi-fn` or `org-billing-fn`.

Bar: the inventory in `LOOP-PROGRESS.md` “Stale code to remove” is gone or
explicitly parked with a reason; `rg` does not find live imports of
`domain-multi-fn`, `org-billing-fn`, or `members-fn`; self-host tests still
prove local name editing, no Plan & billing nav, and no cloud URL controls.

### Track 7: First-win and operational proof

Outcome: typed PLG events remain privacy-safe structured logs, and the complete
fresh-browser journeys work for product feedback, customer support, Help Center,
internal feedback, and self-hosted setup.

Bar: logs can derive step conversion, CTA click-through, time to starter, time to
first win, defer rate, and trial-start failures without email, content, URLs, or
tokens.

### Track 8: Hosted account operations

Hosting and account operations that sit next to the current bar. Not a
bigger product roadmap. UI stays in the workspace (or the existing CP
list for create/open/delete). API for ownership, sibling list, delete,
restore, and account deletion stays on the control plane.

**What already exists**

- CP list + Create + Open. Soft-delete / restore / purge internals
  (`instance-lifecycle-fn`, admin cancel-soft-delete). No customer
  delete/restore on the dashboard.
- Workspace Settings → Members: invite, remove, change role, custom
  roles. First-win still only _requires_ an invite for the internal
  outcome.
- Trial countdown banner from the billing projection (`trialNotice`).
- 3-Free cap on **create** (`c5a484d`). Restore does **not** re-check
  the cap. Soft-deleted rows are not live; restoring one can make a
  fourth live Free workspace.
- SSO entitlement is Scale. Workspace auth already fail-opens admin
  password sign-in when the IdP is not viable after a downgrade. No
  live sweep row.
- Plan catalogue + invoices on CP (`2fb9488`); workspace cards
  (`6418785c8`). Not deployed.
- Cloudflare for SaaS client (`de0b038`); fallback origin active on
  Railway. Domains card not wired.

**Seat (settled for this track)**

A seat is a workspace teammate — an admin or member with a login — not
a portal user, not an end customer. Free applies `maxTeamSeats` from
`tier_limits`. Advertised stickers are **per seat** (CP catalogue /
public pricing page). Stripe checkout is still one line item per
workspace until seat billing is wired. Do not invent Stripe seat
quantities in 8a–8c; 8d is where seat 402s land.

**Units, in order**

1. **8a — Soft-delete, restore, purge, and the 3-Free cap.** Customer
   can soft-delete a workspace from the CP dashboard (owner). Soft-
   deleted is not live and does not count toward the three. Restore
   re-runs `countLiveFreeOwnedBy`; a fourth live Free restore 402s
   with `free_workspace_owner_cap`. Paid restore is unlimited. Purge
   is irreversible and only from trash (operator/admin or explicit
   customer confirm after a stated grace; today's code has `purgeAt`
   null — pick one grace, write it down, do not leave restore
   unbounded if we also promise purge). Tests must exercise the real
   query, not only a stubbed count. Ship with or immediately after
   the `c5a484d` deploy.

2. **8b — In-product workspace switcher.** Admin chrome in the
   workspace lists the signed-in owner's other workspaces (display
   name + friendly URL, never `ws-*` as the address). Choosing one
   Opens through the existing instance Open door. Self-host: absent.
   Data from a CP list endpoint; instance credential; no workspace
   id as authority.

3. **8c — Transfer ownership and leave.** Owner transfers to an
   existing teammate; CP writes `ownerEmail`; 3-Free cap follows the
   new owner (receiver at 3 Free cannot accept a Free workspace).
   Last owner cannot leave. Non-owner can leave. Membership roster
   stays workspace-owned; the CP membership index updates.

4. **8d — Seats, invites on downgrade, SSO live row.** Invite /
   remove / change role already in Members — prove they work on
   cloud. Invite 402s when Free `maxTeamSeats` is reached, named
   plan. Extra seats after downgrade remain; cannot invite more;
   can remove. Pending invites remain acceptable. Live: add IdP on
   Scale → enforce → downgrade → admins still sign in (existing
   fail-open), new SSO-only enforcement does not lock them out.

5. **8e — Visible usage.** Before the 402: Plan & billing and the
   plan notice show trial end date (already derived); Settings and
   the refusing surface show `N of M` for every finite limit
   (boards, posts, seats, sending domains, AI tokens). CP list
   shows `N of 3` Free workspaces. AI budget 0 refuses with a named
   upgrade, not a silent model error. Unlimited (null) is omitted,
   not printed as a fake fraction.

6. **8f — Export, wipe, delete the CP account.** Owner can export
   workspace data from the workspace (tenant DB; no CP provider
   keys). Wipe is owner-only, confirmed, then soft-delete (8a).
   Delete the control-plane account only when the owner has zero
   live workspaces; refuse otherwise with a named reason.

Bar: each unit has focused tests and a live critic on existing
`ws-*` hosts where possible. 8a must not create Neon. 8b–8f must
not either unless a finding cannot be proved on current hosts.

## Deployment order

The billing-ownership and identity **code** pair is already on the Development
fleet (`58eebd173` + `b4afe73`, workspace schema `0262`, CP SQL `0063`–`0067`).
Do not re-run the original “deploy billing then remove workspace billing”
sequence; that work is in the image. Further deploys are incremental.

Remaining identity/domain order:

1. Close Track 1 without custom domains: `cp_instances.name` is not
   authoritative, rename-transfer tests, then two fresh-mailbox walks on
   **new** generated `ws-*.quackback.co.uk` hosts.
2. ~~Configure Cloudflare for SaaS fallback origin.~~ Active on
   `saas-origin.quackback.co.uk` → Railway. Client `de0b038`.
3. Add the shared custom-domain manager on top of
   `cp_workspace_hostname_claims` (identity gateway + Settings card).
   Enable it only after live provider, certificate, stale-update,
   cross-workspace, and cleanup-retry probes pass.
4. Deploy catalogue/invoices (`2fb9488` + `6418785c8`) and prove the
   Plan & billing cards on an existing workspace. Checkout still
   attaches to an existing workspace; Stripe metadata must not create
   one. Then first-win journeys.

Existing `walk-*` / gauntlet instances have registry hostnames and
`cp_instances.name`, but **zero** `cp_workspace_identity` and **zero**
hostname-claim rows. They prove old routing, not the new identity path.
Do not backfill their customer-facing names into the identity ledger.
Do not use them for rename or details proof.

The Development fleet now runs workspace image `58eebd173`
(`sha256:496d295f…`) paired with control plane `b4afe73` (`14dee7a2`) after
control-database migrations `0063`–`0067` and workspace schema `0262`. That
pair proves code is live, not that Track 1’s stranger walk has passed. The
older `03ea102e` / `sha256:596d77e3…` image is historical and proved the
direct-workspace billing path only.

## Definition of done

- Both `saas` branches are clean and contain small, reviewed commits.
- All tracks (0–8) meet their focused bars.
- Two fresh owners receive a workspace without pre-handoff questions and
  complete the handoff journey without repeated authentication.
- Cloud name and platform URL mutations traverse the instance-scoped
  control-plane gateway; self-host shows none of those cloud controls.
  Custom-domain mutations use the same gateway only after the Cloudflare
  provider is live.
- Each outcome reaches its tailored starter and never sees an irrelevant widget
  prompt.
- A real created/configured starter begins one immutable Pro trial.
- Test-mode checkout, plan change, portal (downgrade / cancel / card),
  and webhook finalize traverse the control-plane gateway. Free limits
  and entitlements refuse with a named plan; a paid overlay lifts them.
- Cloud settings (name, URL, billing, and domains when enabled) are
  workspace UI and control-plane API. Self-host shows none of those.
- Soft-delete / restore honour the three-Free cap. The workspace has
  an in-product switcher, owner transfer, leave, visible usage, and
  export / wipe / delete-account paths.
- Invite / remove / change-role honour Free seat limits; SSO
  downgrade still lets admins in.
- The latest `LOOP-VERIFY.md` sweep has no open HIGH SIGNAL findings.
- Cross-workspace isolation, replay, out-of-order projection, retry, outage, and
  exact-expiry probes pass.
- Self-hosted setup shows no cloud commercial surface.
- `LOOP-PROGRESS.md` records commits, test evidence, deployments, and remaining
  operational blockers.
