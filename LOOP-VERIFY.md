# Hosted product verification

Standing bar for Quackback Cloud hosting and management. The loop runs this
sweep in addition to per-unit critics. It is a **quality bar**, not a new
product: a stranger should create, name, share, change plan, hit limits, and
keep using a workspace with the same confidence they would expect from a
mature hosted feedback or support product. It is not a mandate to clone
those products' feature lists.

Authority: `LOOP-PROMPT.md`, then `LOOP-SAAS-FIRST-CUSTOMER.md`, then this
file, then `LOOP-PROGRESS.md` for live evidence.

## Pattern (do not invert)

Every cloud commercial or infrastructure action the customer sees:

- **UI lives in the workspace** (Admin Settings, onboarding, plan notice).
- **API lives on the control plane.** The workspace calls with its instance
  credential. No workspace id is authority. No platform secret lives in the
  workspace.
- **CP dashboard** is a workspace list plus Create / Open / delete. Members,
  billing, domains, and identity polish are not CP screens.
- **Self-host** (cloud capability absent) shows none of those cloud controls
  and never calls the control plane.

A settings page that writes name, URL, plan, domains, or sending identity
straight to a provider, or a CP page that owns members/billing, is HIGH
SIGNAL.

## When to run

Every fire, after finishing or parking the current builder unit — and
**after** any same-fire deploy of customer-visible tips (LOOP-PROMPT
“Deploy + live-verify”). Sweep the digest that is live **now**, not
the previous image.

1. If pickup has undeployed customer-visible shas and no named skip
   applies, do not sweep first: Fleet deploys, then this sweep.
2. Run the **Verify** sweep against the **live** Development pair.
3. Run the **Plan-matrix** critic in §H if it has not been signed against
   the current live image pair. A sweep that only samples one Free cap
   has not signed §H.
4. Classify every finding. Record the sweep and the matrix in
   `LOOP-PROGRESS.md`.
5. Spawn a **Fixer** only for **HIGH SIGNAL** findings that are not already
   being fixed and are not on the stop-and-ask list.
6. Each fixer is still builder then live critic. Merge serially onto
   `saas`. Deploy in the same fire when the finding is customer-visible.

Do not create Neon, mailboxes, or workspaces for a sweep unless the finding
cannot be proved on the existing `ws-*` / friendly hosts. Prefer those hosts.
Fresh mailboxes stay reserved for Open, the 3-Free cap, and isolation probes
that require a new owner.

A per-unit critic does **not** replace this sweep. A sweep does **not**
replace a per-unit critic. §H does **not** replace sweep C or Track 8e.

## Workspace settings contract

Cloud capability on. Each row must exist in Admin Settings (or onboarding
for the first-run identity step) and must call the named CP path.

| Workspace UI                            | Customer operation                                   | Control-plane API                                                 | Self-host                                                   |
| --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Settings → General                      | Display name                                         | `POST /api/v1/internal/identity` `{ displayName }`                | Local `settings.name` only                                  |
| Settings → General + onboarding         | Friendly Quackback URL (**required** on first run)   | `POST /api/v1/internal/identity` `{ platformLabel }`              | Absent                                                      |
| Settings → General (Domains)            | Add / verify / make-primary / remove custom hostname | instance-scoped identity/domains gateway                          | Help Center reverse-proxy stays local; no cloud domain card |
| Settings → Plan & billing               | See plan, trial clock, plan cards, invoices          | projection + `GET …/billing/catalogue` + `GET …/billing/invoices` | Nav item absent                                             |
| Settings → Plan & billing               | Upgrade / change plan (Growth, Pro, Scale × period)  | `POST /api/v1/internal/billing/session` `{ checkout }`            | Absent                                                      |
| Settings → Plan & billing               | Downgrade, cancel, update card, invoices             | `POST /api/v1/internal/billing/session` `{ portal }`              | Absent                                                      |
| Onboarding starter (created/configured) | Begin one Pro trial                                  | `POST /api/v1/internal/billing/activate-trial`                    | Absent                                                      |
| Settings → Emails (cloud)               | Customer sending identity add / verify               | instance-scoped sending gateway; workspace holds no provider keys | Local sending-domain UI allowed                             |
| CP dashboard                            | List, create (≤3 Free), Open, soft-delete, restore   | `/api/instances`, `/open`, lifecycle                              | n/a                                                         |
| Workspace admin chrome                  | Switch to another workspace the owner can open       | instance-scoped sibling list + existing `/open`                   | Absent                                                      |
| Settings → Members (owner)              | Transfer ownership                                   | `POST /api/v1/internal/ownership`                                 | Local owner stays the first admin; no CP call               |
| Settings → Members                      | Leave (non-owner)                                    | workspace roster + CP membership index                            | Local leave only                                            |
| Settings → Members                      | Invite / remove / change role                        | workspace roster; seat cap from projected `tier_limits`           | Local roster; unlimited unless operator set a cap           |
| Plan & billing + refusing surfaces      | Visible `N of M` usage and trial end date            | signed projection + local counts                                  | Operator plan notice only                                   |
| Settings → General (danger)             | Export data, wipe workspace                          | export is workspace-local; wipe then CP soft-delete               | Local export/wipe; no CP account                            |
| CP account                              | Delete the signed-in account                         | CP only, refused while any workspace is live                      | n/a                                                         |

Missing a required cloud settings item, or a cloud item that does not go
through the gateway, is HIGH SIGNAL.

**Custom domains:** the settings surface and CP gateway are in this contract
now. Live add / DNS / certificate proof waits on the Cloudflare for SaaS
integration (operator must ask before a fixer starts that provider). Until
then the Verify row is `skipped (provider)` — not a miss — **unless** a
cloud workspace still exposes a local-only domain writer (Help Center
`setHelpCenterDomain` as if it were the cloud manager). That local writer on
a cloud workspace is HIGH SIGNAL.

## Commercial operations

Free is the baseline. Trial sits beside it. Paid overlays limits in the
least-restrictive direction. `now >= expiresAt` and a completed cancel fall
back to projected Free. No sweeper, no suspension, no second trial.

| Operation         | Probe                                                                                     | HIGH SIGNAL if                                                          |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Free tier         | New workspace with no paid item is Free; limits and entitlements are Free                 | Paid chrome, unlimited cloud limits, or a trial before starter          |
| Trial start       | `created` / `configured` starter → one Pro trial                                          | `deferred` / `unavailable` starts a trial; second trial                 |
| Trial expiry      | Clock fallback to Free; owner still signed in; data intact                                | Lockout, wipe, or entitlements stay Pro                                 |
| Upgrade           | Free or trial → Growth / Pro / Scale via workspace Upgrade                                | 403/500 on own origin; wrong `instanceId`; metadata creates a workspace |
| Change plan (up)  | Paid **Change to {plan}** 303s to Stripe confirm for that price; applies now (pro-rata)   | Generic portal with no target price; checkout 409; wrong instance       |
| Downgrade         | **Change to** a lower paid plan schedules at period end; projection follows then          | Instant entitlement drop; old plan stays after the period ends          |
| Cancel            | Portal cancel → `cancellationAt` set; at that instant, Free                               | Immediate lockout or paid entitlements after the stamp                  |
| Update card       | Portal from Manage billing                                                                | Workspace-owned billing route; missing nav when `canManageBilling`      |
| Webhook finalize  | Test payment → projection version increases on **that** workspace                         | No fan-out, or a different workspace updates                            |
| Limit overlay     | After upgrade, a previously refused create succeeds                                       | Old Free cap still refuses                                              |
| Downgrade refuse  | After downgrade, a new board / domain / SSO / webhook over the cap 402s with a named plan | Silent no-op or 500                                                     |
| Existing over-cap | Downgraded workspace can still **clear** / disable an over-cap resource                   | Cannot delete the extra board / domain / IdP                            |
| Outage            | CP down: product works from last projection; billing actions retryable                    | Hard fail of inbox/board; billing 500 with no retry copy                |

Numeric limits (`maxBoards`, `maxPosts`, `maxTeamSeats`, `maxStatusComponents`,
`maxCustomRoles`, `maxSendingDomains`, `aiTokensPerMonth`) and feature flags
(`customDomain`, `customOidcProvider`, `webhooks`, `mcpServer`, …) come from
`settings.tier_limits` written by the control plane (same channel as
self-host config). Default (no row) is unlimited — that default is **only**
correct when cloud is off.

The full per-plan, UI + server critic is §H. Rows 15–16 below are the
spot-check; they do not close the matrix.

## Sweep

Read-only except where a row says otherwise. Use existing live hosts.
Record URL, status, and a screenshot or HTTP transcript per row. Skip a
row only when the capability is explicitly parked or `skipped (provider)`,
and say so.

### A. First-run hosting

| #   | Surface          | Probe                                                            | HIGH SIGNAL if                                                                           |
| --- | ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | Create / Open    | CP sign-in → workspace with no pre-handoff form → OTT session    | Named-create form, 5xx, no auto-open, owner must sign in again                           |
| 2   | Cloud identity   | Name + **required** friendly URL; no generated host by the field | Skip, optional URL, `ws-*` shown or prefilled. Local fix is uncommitted on `saas-merge`. |
| 3   | Onboarding Ready | Each outcome has a primary enter action                          | No button; copy-only with no way into the product                                        |
| 4   | Public board     | GET the starter board as a visitor                               | 5xx, wrong tenant, `/{slug}/feedback` as the cloud URL                                   |
| 5   | Admin            | Owner reaches inbox / feedback                                   | Unexpected auth wall, 5xx                                                                |

### B. Settings IA and gateway

| #   | Surface         | Probe                                                                   | HIGH SIGNAL if                                            |
| --- | --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| 6   | Settings nav    | Cloud: General + Plan & billing present. Self-host: billing absent      | Billing on self-host; General missing URL on cloud        |
| 7   | General → CP    | Save name / URL hits identity gateway; no local-only cloud write        | Direct provider call; workspace id in the body            |
| 8   | Billing → CP    | Upgrade / Change plan / Manage billing POST `/api/billing/session` → CP | Workspace billing tables, secrets, or catalogue           |
| 9   | Domains surface | Cloud Settings exposes custom-domain UI that would call CP              | Local Help Center domain writer used as the cloud manager |
| 10  | Emails (cloud)  | Sending-identity UI does not hold platform mail keys                    | SES/provider secret in the workspace                      |

### C. Plans, Free, limits

| #   | Surface            | Probe                                                                                     | HIGH SIGNAL if                                                               |
| --- | ------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 11  | Free baseline      | Unpaid live workspace is Free                                                             | Trial without starter; paid entitlements                                     |
| 12  | Upgrade            | Owner 303s to test Checkout; metadata is this `instanceId`                                | 403/500 on own origin; new workspace created                                 |
| 13  | Portal             | Manage billing 303s to the hosted portal                                                  | Missing when `canManageBilling`; wrong return host                           |
| 14  | Change / downgrade | Checkout or portal to another catalogue plan; projection follows                          | Old plan entitlements stick; wrong tenant updated                            |
| 15  | Limits             | A Free cap refuses with a named upgrade; a paid overlay lifts it. Full matrix is §H.      | Unlimited on cloud Free; refuse after upgrade; UI-only or server-only gate   |
| 16  | Entitlements       | SSO / webhooks / custom domain / workflows 402 on Free with plan name. Full matrix is §H. | Feature works on Free; refuse copy has no plan; UI unlocked when server 402s |
| 17  | 3-Free cap         | Fourth live Free create                                                                   | Succeeds, or 402 is indistinguishable                                        |

### D. Isolation, rename, fail-closed, fleet

| #   | Surface         | Probe                                                       | HIGH SIGNAL if                                |
| --- | --------------- | ----------------------------------------------------------- | --------------------------------------------- |
| 18  | Isolation       | Cross-workspace GET/POST, billing metadata, hostname claims | Data, session, or charge on the other tenant  |
| 19  | Rename / assets | Friendly rename; old host 308; `src` stays `/api/storage/…` | Two canons, session death, baked origin       |
| 20  | Fail closed     | Replay/expiry/wrong-workspace OTT; foreign Origin           | Silent success, opaque 500                    |
| 21  | Self-host       | Cloud capability absent                                     | Trial, billing nav, cloud URL/domain controls |
| 22  | Fleet           | Ready 200; digest matches; web `us-east4-eqdc4a`            | Digest drift, web on `sfo`, ready 5xx         |

### E. Account lifecycle, seats, usage

| #   | Surface                 | Probe                                                                      | HIGH SIGNAL if                                                      |
| --- | ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 23  | Soft-delete / restore   | Owner soft-deletes; slot frees; restore at 3 live Free 402s same reason    | Restore creates a fourth live Free; trash still listed as live      |
| 24  | Switcher                | In-product list of the owner's other workspaces; Open works                | Missing on cloud; shows `ws-*` as the address; present on self-host |
| 25  | Transfer / leave        | Owner transfers to a teammate; last owner cannot leave                     | Cap does not follow `ownerEmail`; owner can leave and orphan        |
| 26  | Seats                   | Invite at Free `maxTeamSeats` 402s named; extra seats after downgrade stay | Unlimited invites on cloud Free; cannot remove extras               |
| 27  | SSO downgrade           | Scale IdP enforced → downgrade → admin password still works                | Admins locked out; SSO still required on Free                       |
| 28  | Visible usage           | Trial end date; `N of M` on finite limits; `N of 3` Free on CP list        | First signal is a bare 402; AI budget 0 is an opaque model error    |
| 29  | Export / wipe / account | Owner export; wipe then soft-delete; CP account delete refused if live     | Wipe without confirm; account delete with live workspaces           |

### G. Billing page (catalogue)

After CP `2fb9488` + app `6418785c8` are live:

| #   | Surface     | Probe                                                                                | HIGH SIGNAL if                                              |
| --- | ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 30  | Plan cards  | Four cards from `GET …/catalogue`; annual default; current marked                    | Local price list; empty strip only; `ws-*` in copy          |
| 31  | Invoices    | Table from `GET …/invoices`; View is an https hosted URL                             | Provider ids in the workspace; 5xx; other tenant's invoices |
| 32  | Change to X | Paid card POSTs `checkout` + `planId` + period; 303 to Stripe confirm for that price | Generic portal; 409 “use Manage billing”; no target price   |

### F. Custom domains (live provider)

Provider is started (fallback origin active, CNAME target
`customers.quackback.co.uk`). Sweep adds, once the workspace Domains
card is wired: add → DNS instructions → certificate ready → make
primary → old host redirects → remove → cross-workspace claim refused
→ stale provider update retried. Until that card exists, row 9 is
HIGH if a cloud workspace still uses the Help Center local writer.

Do not fail the sweep for copy nits, spacing, unused translations, or a
parked row. Those are LOW.

Parked (not a sweep miss): Redis/BullMQ, invoice PDFs, dunning beyond
“update your card”, unwired entitlement keys (`aiAssistant`, `apiAccess`),
unwired feature flags (`ipAllowlist`, `aiFeedbackExtraction`) and API
rate counters, Workers-as-app, a general cloud gateway. §H still
records those rows as skipped.

## H. Plan-matrix critic (every tier, UI + server)

Standing **Critic** cycle. Later fires pick this up. It is the review of
every commercial limit and entitlement against the **active plan**, on
both the workspace UI and the server function (or REST) that would
create the resource.

Sweep C rows 15–16 and Track 8e are samples. This section is the
matrix. A fire that only proves `maxBoards` on one host has not signed.

### Authority (do not pick a winner)

| Layer                   | Source of truth                                            | Used for                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric + feature flags | CP `src/lib/server/plans/definitions.ts`                   | `getTierLimits` / `enforceCountLimit` / `assertTierFeature` / `enforceAiTokenBudget`                                                                              |
| Entitlement grants      | CP `PLAN_GRANTS` in `billing/projection.ts`                | signed `entitlements` map                                                                                                                                         |
| Workspace plan names    | `PLAN_CATALOGUE.grants` in `cloud.types.ts`                | refusal copy (`minimumPlanFor`) — **must match** `PLAN_GRANTS`                                                                                                    |
| Overlay                 | workspace `resolveEffectiveTierLimits`                     | no stored row + projection present is **not** OSS unlimited; features from projection entitlements; numeric least-restrictive; `now >= planLimitsExpireAt` → Free |
| Advertised stickers     | CP `GET …/billing/catalogue` (same as `~/website` pricing) | Plan & billing cards. Must not contradict enforcement                                                                                                             |

Trial overlays **Pro**. Cancel and `now >= expiresAt` fall back to
**Free**. Self-host (no projection, cloud off) is OSS unlimited and
never 402s.

**Known drifts the critic must record** (HIGH if a customer would be
refused after trusting the card, or allowed after the catalogue said
no). Do not silently prefer marketing or code:

- Website: unlimited boards and posts on every plan. CP: Free 2 / 50,
  Growth 3 / 50, Pro 10 / unlimited.
- Website: 1 Free workspace. Product: 3 live Free per owner.
- Website: paid seats uncapped, billed per seat. CP: Growth 1, Pro 10,
  Scale unlimited. Stripe checkout qty is still 1 until Track 8d.
- Website status components 5 / 25 / unlimited / unlimited. CP: 3 / 10
  / 25 / unlimited.
- Website inbound addresses 1 / 1 / 2 / unlimited. CP sending domains:
  0 / 1 / 3 / unlimited.
- Website custom colours on Free. CP `customColors` false until Pro.
- Website REST 100K / 1M / 2M. CP `apiRequestsPerMonth` 10K / 10K /
  250K / 2M.
- Website custom admin roles Scale-only. CP `maxCustomRoles` 0 / 0 / 5
  / unlimited.
- `PLAN_GRANTS` Growth includes `webhooks` and `mcpServer`.
  `GROWTH_TIER_LIMITS.features` has both **false**. With no stored row
  the overlay follows entitlements. A Growth workspace that can use
  one helper and not the other is HIGH.

### Dual gate

Every **wired** limit and entitlement is checked twice. Missing either
side is HIGH.

1. **UI** (workspace). The create / enable control is locked or shows
   an upgrade CTA **before** submit. Finite counts show `N of M`
   (Track 8e). Copy names the cheapest plan that lifts the gate
   (`minimumPlanFor` / “Upgrade to {Plan}”). Existing over-cap
   resources stay listed and can be deleted or disabled.
2. **Server** (workspace server-fn or REST; never a client-only
   check). The mutating path returns **402**:
   - numeric: `error: tier_limit_exceeded`, `limit`, and `current` /
     `max` when known;
   - entitlement: `error: entitlement_required`, `currentPlan`,
     `requiredPlan`.
     GET / list / delete of an existing over-cap resource must **not**
   402.

Self-host: neither gate fires. Cloud chrome on self-host is HIGH.

### Plan states

Prefer existing live hosts. Do not create Neon. Do not create a fourth
Free workspace. Do not complete a payment (Stripe-live owns that).

| State         | Live fixture                                                                        | Effective                     |
| ------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| Free unpaid   | any live unpaid workspace                                                           | `FREE_TIER_LIMITS`, no grants |
| Trial         | t1e (Pro trial)                                                                     | Pro overlay                   |
| Trial expired | clock / `planLimitsExpireAt`                                                        | Free                          |
| Growth paid   | t1a projection v4                                                                   | Growth                        |
| Pro paid      | existing paid host or Stripe-live leftover; no new Neon                             | Pro                           |
| Scale paid    | skip live mutation until a Scale host exists; still run the catalogue / code critic | Scale                         |
| Canceled      | portal `cancellationAt` reached                                                     | Free                          |
| Self-host     | cloud capability absent                                                             | OSS unlimited                 |

### Numeric matrix

`∞` means `null` (unlimited). Server helpers live in
`tier-enforce.ts` unless noted.

| Key                    |    Free |    Growth |       Pro |       Scale | Server chokepoint                                          | UI surface                      |
| ---------------------- | ------: | --------: | --------: | ----------: | ---------------------------------------------------------- | ------------------------------- |
| `maxBoards`            |       2 |         3 |        10 |           ∞ | `board.service` create                                     | Boards create; launch checklist |
| `maxPosts`             |      50 |        50 |         ∞ |           ∞ | `post.service` create                                      | Board / new post                |
| `maxTeamSeats`         |       1 |         1 |        10 |           ∞ | `seat-limit.ts` on invite                                  | Members invite `used / limit`   |
| `maxStatusComponents`  |       3 |        10 |        25 |           ∞ | `enforceStatusComponentLimit`                              | Status settings                 |
| `maxCustomRoles`       |       0 |         0 |         5 |           ∞ | `role.service` create                                      | Roles                           |
| `maxSendingDomains`    |       0 |         1 |         3 |           ∞ | `enforceSendingDomainLimit`                                | Settings → Emails (cloud)       |
| `aiTokensPerMonth`     | 100_000 | 1_000_000 | 5_000_000 | 200_000_000 | `enforceAiTokenBudget`                                     | Plan notice / Copilot usage     |
| `apiRequestsPerMonth`  |  10_000 |    10_000 |   250_000 |   2_000_000 | **not fully wired** — record the gap; do not invent a gate | —                               |
| `apiRequestsPerMinute` |      60 |        60 |       300 |       1_200 | same                                                       | —                               |

At cap: UI refuses first; server 402s if the UI is bypassed. Over cap
after downgrade: extra rows remain; new creates 402; deletes succeed.

### Feature + entitlement matrix

`requireEntitlement` names a plan. `assertTierFeature` does not — the
UI must still name one via `minimumPlanFor` / Plan & billing. Both
layers must agree for keys that have both.

| Key                          | Free | Growth                 | Pro | Scale | Layer            | Server chokepoint                                                    | UI                                    |
| ---------------------------- | ---- | ---------------------- | --- | ----- | ---------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `customDomain`               | no   | yes                    | yes | yes   | both             | `help-center-domain.service` (and the CP domains gateway once wired) | Settings Domains / Help Center domain |
| `sso` / `customOidcProvider` | no   | no                     | no  | yes   | both             | `sso.ts` upsert; `auth-provider-credentials`; settings OIDC          | Security → Authentication             |
| `ipAllowlist`                | no   | no                     | no  | yes   | feature only     | **unwired** — record; do not invent                                  | —                                     |
| `webhooks`                   | no   | grant yes / feature no | yes | yes   | both (**drift**) | `webhook.service` create                                             | Developer → Webhooks                  |
| `mcpServer`                  | no   | grant yes / feature no | yes | yes   | both (**drift**) | `mcp/handler.ts`; settings MCP toggle                                | Developer → MCP                       |
| `analyticsExports`           | no   | no                     | yes | yes   | feature          | export routes / `assertTierFeature`                                  | Analytics export                      |
| `customColors`               | no   | no                     | yes | yes   | feature          | `settings.media`                                                     | Branding                              |
| `customCss`                  | no   | no                     | yes | yes   | feature          | `settings.media`                                                     | Branding                              |
| `integrations`               | no   | no                     | yes | yes   | feature          | `platform-credentials`                                               | Integrations                          |
| `aiFeedbackExtraction`       | no   | no                     | no  | yes   | feature          | **unwired** — record; do not invent                                  | —                                     |
| `aiDrafts`                   | no   | yes                    | yes | yes   | entitlement      | `copilot-gate.ts`; `macro.service`                                   | Inbox drafts / macros                 |
| `aiInsights`                 | no   | no                     | yes | yes   | entitlement      | `summary.service`; `sentiment.service`                               | Insights                              |
| `workflows`                  | no   | no                     | yes | yes   | entitlement      | `workflow.service` create                                            | Workflows                             |
| `auditLog`                   | no   | no                     | no  | yes   | entitlement      | `audit-log.ts`                                                       | Audit log                             |
| `aiAssistant`                | no   | yes                    | yes | yes   | **unwired**      | skip                                                                 | skip                                  |
| `apiAccess`                  | no   | yes                    | yes | yes   | **unwired**      | skip                                                                 | skip                                  |

Skipped keys are not a miss. A **wired** key with no UI lock, or a UI
lock with no server 402, is HIGH.

### Overlay / change-plan (still required)

| Probe                                                             | HIGH SIGNAL if                                     |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| After upgrade, a previously refused create succeeds               | Old Free cap still refuses                         |
| After downgrade, a new create over the cap 402s with a named plan | Silent no-op or 500                                |
| Existing extra board / domain / seat / IdP can still be cleared   | Cannot delete the extra                            |
| Trial active = Pro numbers and Pro/Growth grants                  | Free caps during trial; Scale-only keys granted    |
| Trial or cancel expiry = Free numbers and no paid grants          | Entitlements stay Pro; lockout or wipe             |
| Projection present, no `tier_limits` row                          | OSS unlimited                                      |
| Operator row + paid projection                                    | Least-restrictive overlay is ignored               |
| Fourth live Free create or restore                                | Succeeds, or 402 is not `free_workspace_owner_cap` |

### How a later fire runs it

Named **Plan-matrix** critic (Critic lane). Give it only: this section,
live CP and workspace URLs, current digests, and the fixtures in
`LOOP-PROGRESS.md`. It does not see the builder’s self-assessment. It
must exercise the live system (UI click or HTTP against the named
chokepoint). A critic that only reads the diff has not signed.

Output, and nothing else:

- `PASS` / `FAIL`
- one row per `(state × limit-or-entitlement × UI|server)`: result,
  signal (HIGH / LOW / skipped)
- each HIGH finding as one paragraph: what, URL/status, why it is HIGH
- instance count before and after (must not rise)

It does not edit, commit, deploy, create Neon, or complete a payment.

Run:

- once per fire after Verify if this cycle has not been signed against
  the current live image pair;
- again after any change to `definitions.ts`, `PLAN_GRANTS`,
  `PLAN_CATALOGUE`, `resolveEffectiveTierLimits`, the CP catalogue, or
  a refusing UI / server-fn.

Missing `N of M` on a finite wired limit is HIGH (Track 8e / Fixer).
Catalogue vs enforcement disagreement is HIGH. Dual-layer grant vs
feature disagreement is HIGH.

## Signal

**HIGH SIGNAL** — spawn a Fixer:

- Blocks the stranger walk or leaves a customer on a screen with nothing to press.
- A required cloud settings item is missing, or it bypasses the CP gateway.
- Security or isolation: wrong tenant, replay that works, origin bypass.
- 5xx or failed dynamic import on a happy-path customer URL.
- Billing that charges, opens, or projects the wrong workspace.
- Plan change / downgrade / cancel / expiry that leaves the wrong limits.
- Cloud Free with unlimited `tier_limits` (no row) once a projection is present.
- A wired limit or entitlement that refuses only in the UI or only on
  the server, or a 402 that does not name the plan / limit.
- Advertised catalogue (or public pricing) that grants a feature the
  active plan then 402s, or that hides a feature the plan then allows.
- `PLAN_GRANTS` and `tier_limits.features` (or workspace
  `PLAN_CATALOGUE.grants`) disagree for the same key on the same plan.
- Restore of a Free workspace that skips the three-Free cap.
- Missing switcher / transfer / leave / usage on cloud, or a 402 with no
  prior `N of M` / trial clock.
- Session loss on Open, rename, or origin transfer.
- Cloud chrome on a self-host, or generated `ws-*` presented as the address.
- A refusal with no distinguishable reason (Bar B).
- Customer-visible pickup row still `Live? no` with no named skip
  (Bar F). Do not spawn a Fixer for this — the orchestrator takes
  **Fleet** in the same fire, then a live critic.

**LOW** — record and leave:

- Wording, density, icon choice, “would be nicer if”.
- Anything on the parked list.
- A unit already in “Next commits” with a live owner.
- A critic-only style note.
- Custom-domain _live certificate_ proof before the operator has asked
  to start the provider.

If unsure, it is LOW unless a stranger would bounce, a tenant boundary
moves, or a cloud setting writes around the control plane. Do not spawn
a fixer to relitigate a settled decision. Do not spawn a fixer that
starts Cloudflare for SaaS, a live Stripe key, or a new hosting
provider — those remain stop-and-ask.

## Verify lane

Read-only child. Give it only: this file, live CP and workspace URLs,
current digests, the existing `ws-*` / friendly hosts, and
`LOOP-PROGRESS.md` “Verification still required”. It does not see the
builder’s self-assessment.

It must exercise the live system. A sweep that only reads the diff has
not signed. Discard that verdict.

When this fire also runs §H, attach the plan-matrix table (or spawn a
separate Plan-matrix critic). Do not treat sweep C rows 15–16 as §H.

Output, and nothing else:

- `PASS` / `FAIL`
- table of rows: surface, result, signal (HIGH / LOW / skipped)
- each HIGH finding as one paragraph: what, URL/status, why it is HIGH
- instance count before and after (must not rise)

It does not edit, commit, deploy, or create Neon. It does not complete a
payment (Stripe-live owns that).

## Fixer lane

One HIGH finding per fixer. Isolated worktree if it writes `saas` or the
shared CP tree. It does not merge or deploy.

Give it only: the finding, the bar it violates, the commit range to treat
as base, and the live URLs. It writes the smallest coherent fix, focused
tests, and a commit on its worktree.

Then the orchestrator:

1. Merges serially onto the relevant `saas`.
2. Deploys in the same fire if the finding is customer-visible
   (LOOP-PROMPT “Deploy + live-verify”). Confirm `meta.imageDigest`.
3. Spawns a **live** critic on those URLs (not the sweep, not vitest).
4. Records sha, digest, and critic in `LOOP-PROGRESS.md`.

The same finding failing its critic **three** times is a stop-and-ask. Do
not lower the bar. Do not spawn a second fixer on the same files while
the first is open.

## Concurrency

| Lane            | Writes                         | Parallel with                                   |
| --------------- | ------------------------------ | ----------------------------------------------- |
| **Verify**      | nothing                        | CP-create, Track-6 ops, critics on _other_ URLs |
| **Plan-matrix** | nothing (read-only §H critic)  | same as Critic; do not share hosts              |
| **Fixer**       | isolated worktree, one finding | critics; other fixers on _other_ files          |

Not in parallel with Fleet. Not two Verifies. Not a Fixer and another
editor of the same files on `saas`. Stripe-live still owns payment +
webhook; Verify may observe billing GETs/POSTs on existing hosts but
must not complete a payment.

## Definition of done (this file)

The latest recorded sweep has **no open HIGH SIGNAL** rows, and the
first-customer definition of done in `LOOP-PROMPT.md` is otherwise met.
LOW rows may remain. Provider-skipped domain rows stay skipped until
that integration is live.
