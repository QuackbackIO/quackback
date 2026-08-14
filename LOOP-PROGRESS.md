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
generated immutable identifiers and no name, URL, region, or plan form. Name
and a required friendly platform URL are set post-handoff (and again in
Admin Settings → General). Custom domains use the same workspace-UI /
control-plane-API pattern once the hostname provider is live. Cloud
mutations traverse the instance-scoped control-plane client and return as
signed monotonic identity projections. The generated system host is never
presented as the customer address.

Development infrastructure supports registry-only platform URL changes: the
live Railway web service owns `*.quackback.co.uk`, Cloudflare is authoritative
DNS, and the wildcard CNAME reaches that one pooled service with a matching
wildcard certificate. Arbitrary customer domains are not covered by that
certificate. The existing control-plane ownership verifier and registry writer
therefore remain incomplete until a control-plane-owned Cloudflare for SaaS
Custom Hostnames integration proves both hostname and SSL readiness.

## Current revisions

- Workspace tip: `31330d85b` (limits overlay merge). Live image is `6d4d9f252` /
  `ghcr.io/quackbackio/quackback@sha256:139a4a8c6873d14c1d4cc129d8f3e2d286ccaaea90e2ab0e86766944b8219570`
  (includes Origin-fix `635cdb149`). Re-checked this fire: web `683a4b07`
  SUCCESS, `source.image` and `meta.imageDigest` match, region only
  `us-east4-eqdc4a`. No fleet deploy.
- Control plane: `71e59d9` live as `f135274f` /
  `sha256:a005414fa8a2e49e128a47abc59f221198e76214c78a7516894ef9e967def597`
  (redeploy after test Stripe key + price seed; still `sfo`). Local CP
  tip is `c5a484d` (3-Free cap, not deployed).
- Last known deployed workspace: `6d4d9f252` (2026-08-14)
- Last known deployed control plane: `f135274f` (2026-08-14)

The Development fleet now runs a paired image/code pair for identity and
billing-ownership work. Fresh-browser onboarding/rename journeys are still
required before the revised tracks can close.

Workspace image `ghcr.io/quackbackio/quackback@sha256:b3ff89f240c184bec4beefc775bd06959bfb9e2d1c0ef393379ae90e0529fc5f`
was published from Docker workflow `31820406329` at commit `98212c18c`
(Unit C `a796b8885` plus the origin-transfer import-protection fix).
Verified `meta.imageDigest` matches on web `dfa00417`, worker `bdd32ec8`,
cron-hourly `e06f2212`, cron-daily `e744f960`, and migrator `ec4b5f0f`.
Web remains in `us-east4-eqdc4a`. Live probe: `GET
https://gauntlet.quackback.co.uk/api/health/ready` → 200
`{"status":"ok","role":"web"}`; `GET /api/storage/logos/unit-c-probe.png`
→ 404 (no object; route present). The previous `58eebd173` /
`sha256:496d295f…` image is historical.

Control plane live is `07d5737e` from a concurrent CLI `railway up` at
16:42Z (digest `sha256:ffdd51a2…`, still `sfo`). This fire did not
change CP source or redeploy it. `7eca55b3` (`a040f78`) is REMOVED.
First `railway up` of `a040f78` 500'd because
`BILLING_PROJECTION_PRIVATE_KEY` was unset. Generated the first Ed25519
pair (private on CP; `QUACKBACK_CP_PROJECTION_PUBLIC_KEY` on web /
worker / crons / migrator, skip-deploys). Live `/assets/setup._orgId-*.js`
contains “Creating your workspace” and “Opening your workspace”; the
named-create card copy is gone.

Fresh-mailbox `/setup` hydrates. Live chunk
`/assets/setup._orgId-DOHT4ynR.js` has no `node:crypto` and contains
“Creating your workspace” / “Opening your workspace”. The old
`D7jp-les` 404 is a stale browser cache; hard-refresh, do not refactor
the CP again for it. Named-create copy is gone. Screenshot of a later
zero-input create: `loop-evidence/t1a/03-setup.png`.

Unit C (`a796b8885`) persists `/api/storage/<key>` (private: `?read=`)
and absolutizes email, widget, OG, and vision from the immutable
system-host pin. Legacy absolute srcs stay accepted; the fleet is not
rewritten; bucket prefix stays `w/<workspaceId>/`. The first Docker
dispatch of that commit failed import-protection because
`auth.origin-transfer` statically imported a module that reached the
workspace database; `98212c18c` moves the server fn into the route.
Focused verification: 187 (storage/email/OG/vision) + 33 (related) +
7 (`origin-transfer.db`) passed. Deployed as
`sha256:b3ff89f240c184bec4beefc775bd06959bfb9e2d1c0ef393379ae90e0529fc5f`.

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

| Track                            | Status                                                                                                     | Evidence                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0 contextual activation          | implemented, focused verification passed                                                                   | `d2b8accca`, `029727e26`                                                                                          |
| 1 zero-input create + identity   | live rename + stored `/api/storage` src + old-friendly 308 on `689c99d13`; two-mailbox Open already proved | see “Track 1 live walk (2026-08-14)”                                                                              |
| 2 focused widget activation      | implemented, focused verification passed                                                                   | `13df888fa`                                                                                                       |
| 3 CP billing foundation          | live test-mode **payment** + webhook finalize on existing t1a; checkout/portal + form 303 already proved   | CP `f135274f` / `71e59d9`; app `635cdb149` / `139a4a8c`; see “Track 3 live payment (2026-08-14)”                  |
| 4 workspace projection + gateway | paid Growth projection v4 on t1a; catalogue+invoices **code** landed, not live                             | projection v4; CP `2fb9488`; app `6418785c8`                                                                      |
| 5 authoritative starter trial    | live Pro trial on both `ws-*` hosts; retry helper now in live image `703eca7d`                             | CP `2fa8a08`, `710ab09`; app `57ff32499` deployed `0c42bbe1f`; see “Track 3/5 live billing (2026-08-14)”          |
| 6 remove workspace billing       | implementation complete; boundary scan pending                                                             | app `178f0bf9b`, `3908c1031`; CP `8cb9738`, `3bb1c37`                                                             |
| 6b remove stale SaaS code        | welcome no longer mails `login_url`; local fixture at 0262                                                 | CP `e2219f5`, `7230a32`, `546b26e`, `6836a6a`, `be35af1`; local `quackback` + `quackback_test` migrated to `0262` |
| 7 PLG + first-win proof          | infrastructure implemented                                                                                 | `33c15ba53`; first-win journeys remain                                                                            |
| 8 hosted account operations      | specified; 8a–8f not started                                                                               | restore must re-check 3-Free; switcher, transfer, leave, seats, usage, export/wipe                                |

## Pickup for critics and later fires

Use this table. Do not rediscover work that already has a sha. Do not
print the Cloudflare token. Preserve uncommitted onboarding files.

| Unit                           | Where                | Sha                                                                                                 | Live?                    | Critic should prove                                                                                                                                                                                                                            |
| ------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready CTA + required cloud URL | app, **uncommitted** | working tree on `saas-merge` (`_layout.complete.tsx`, `_layout.workspace.tsx`, `platform-label.ts`) | no                       | Ready always has a primary button (Open your board / launch plan). Cloud URL required; Continue disabled without it; no Skip; no `ws-*` prefilled or printed by the field. Tests: `cloud-details-goal`, `activation-action`, `platform-label`. |
| 3-Free create cap              | CP                   | `c5a484d`                                                                                           | no                       | 1–3 Free ok; 4th 402 `free_workspace_owner_cap`; paid unlimited. Then **8a**: restore of a Free workspace at 3 live 402s the same reason.                                                                                                      |
| Limits overlay                 | app                  | `31330d85b` / `b0c13a366`                                                                           | no                       | Cloud workspace with a projection and no `tier_limits` row is **not** OSS unlimited. Re-sweep `LOOP-VERIFY.md` row 15 after deploy.                                                                                                            |
| CF for SaaS origin + client    | zone + CP            | `de0b038`; fallback **active**                                                                      | token on CP, skip-deploy | Fallback `saas-origin.quackback.co.uk` CNAME to Railway (not `100::`). Customer target `customers.quackback.co.uk`. Client create/get/delete; no provider ids in projections. **Next builder:** identity gateway + Settings Domains card.      |
| Plan catalogue + invoices      | CP + app             | CP `2fb9488`, app `6418785c8`                                                                       | no                       | `GET /catalogue` stickers: Growth $32 / $300, Pro $62 / $588, Scale $115 / $1068, annual = 10 months. `GET /invoices` hosted https URLs only. UI: four cards, period toggle, invoice table. Paid change-plan still portal.                     |
| Verify sweep                   | live                 | `loop-evidence/verify-2026-08-14/sweep.md`                                                          | FAIL 1 HIGH              | After limits+billing deploy, re-run the whole sweep. Fixer only for HIGH.                                                                                                                                                                      |
| Track 8b–8f                    | neither              | specified in `LOOP-SAAS-FIRST-CUSTOMER.md`                                                          | no                       | Switcher, transfer/leave, seats+SSO downgrade, `N of M` usage, export/wipe/account delete. After 8a.                                                                                                                                           |

**Fleet note:** one deploy thread. Prefer one CP deploy that includes
`c5a484d` + `de0b038` + `2fb9488`, and one app deploy that includes
`31330d85b` + `6418785c8` + the onboarding commit once it lands.
Then one critic on the live pair (not a diff-only critic).

**Do not invert:** Workers-as-app is out; fallback stays Railway.
Catalogue is CP-owned. Seat _stickers_ are per-seat; Stripe qty is
still 1 until 8d.

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

Both worktrees were clean after workspace commit `1add15b16` and control-plane
commit `4a1e97b`. The workspace
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
tests and control-plane typecheck. `546b26e` then stopped writing that
display name into leftover `cp_instances.name`: creates store `''` there,
provisioning identity carries only immutable identifiers, and customer
tiles / ready emails / admin lists read `cp_workspace_identity`. The
column is not dropped. Typecheck passed; focused verification 168 tests.

`6836a6a` then stopped leftover `cp_instances.custom_domain*` from
routing: provisioning no longer injects those columns into the tenant
registry, `getInstanceOverview` no longer returns `customDomain`, and
the unused `getActivePlans` / `getInstanceDomains` loaders plus the
dead `selectUpgradeTarget` picker are deleted. Columns stay until no
replica SELECTs them. Typecheck passed; focused tests 56 passed
(provisioner, instance-claim-link, one-screen, domains, instance-fn).

`be35af1` then stopped mailing leftover `login_url`. Owner welcome and
the billing-contact notice both point at `/dashboard`; both refuse any
string that looks like a magic-link. Dashboard tiles and ReadyPane
already POST `/api/instances/:id/open`. Bootstrap still writes
`login_url` so admin-seeded presence stays true. Typecheck passed;
focused tests 117 passed (welcome, provider-ladder, bootstrap-owner,
tenant-actions, instance-claim-link, workspace-owner).

The workspace verifies and monotonically applies the separate identity stream,
redirects safe requests away from obsolete hosts without opening a tenant
database, transfers the current owner session across a rename, and exposes
cloud identity only when a verified projection exists. Admin Settings and the
post-handoff details step use the instance-scoped gateway; self-hosted setup
retains local name editing and makes no identity-gateway call. Cloud onboarding
now has an optional details screen followed by the outcome screen, with one
primary action on each. Focused onboarding UI/state verification passed: 54
tests across the latest slices; the full workspace typecheck passed. The local
real-Postgres fixture (`quackback` fallback and `quackback_test`) was migrated
to `0262_cloud_identity_projection` on 2026-08-14: `0261` dropped leftover
workspace billing tables, `0262` added `settings.cloud_identity` and
`cloud_identity_revision`. The 13 onboarding bootstrap-claim tests that
probed those columns no longer skip. Focused verification: 27 passed
(`onboarding-bootstrap-claim` 13, `onboarding-workspace-claim` 8,
`onboarding-state-readonly` 6). Development Neon workspaces were already at 0262.

`1add15b16` extracts origin-transfer consume to a server function and covers
it against real `settings.cloud_identity`, `verification`, and `session`
rows: a valid token on the new canonical host establishes the session and
burns the row; replay and expiry fail closed; the leftover system host and
another workspace host refuse without deleting the token so the rightful
consume can still succeed. The HTTP handler is what attaches Set-Cookie.
Focused verification: 24 passed (`origin-transfer.db` 7, host-binding 1,
`s3-tenant-placement` 16 including the system-host publicUrl after a
friendly rename). Control-plane `4a1e97b` asserts the registry rename
moves `routing.baseUrl` and leaves `storage.publicUrl` on the immutable
system host. Registry integration: 1 passed (31 skipped in that file).

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

## Track 1 live walk (2026-08-14)

Two fresh guerrilla mailboxes, **new** generated hosts (not `walk-*`):

| Mailbox                             | Workspace                         | Host                                          |
| ----------------------------------- | --------------------------------- | --------------------------------------------- |
| `walk-t1e-a7ebad@guerrillamail.com` | `inst_01m00kprbrfzzb19f490wga8q2` | `ws-4a048e07941c5e7840e986c0.quackback.co.uk` |
| `qb-t1a-7caf14b1@guerrillamail.com` | `inst_01m00kq6cdfzzb19gfjz8pt0s7` | `ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk` |

Proved on live `07d5737e` / `98212c18c`:

- Setup chunk `setup._orgId-DOHT4ynR.js` has **no** `node:crypto`. Named-create copy is gone. Old `D7jp-les` 404s need a hard refresh.
- Sign-in OTP → `/dashboard` 307 → `/setup/$orgId` auto-creates. Heading “Creating your workspace”, copy “nothing you need to choose yet”. Shots: `loop-evidence/t1a/03-setup.png`, `loop-evidence/track1-a-setup.png`.
- `cp_instances.name` leftover is `''`. Display name is `Untitled workspace` on `cp_workspace_identity`. DB name `qb_<24hex>`.
- OpeningPane auto-POSTs `/api/instances/:id/open` and 302s to `https://ws-…/admin?ott=`. Shot: `loop-evidence/t1e/04-opening.png`.
- First identity outbox attempt 401’d (`invalid_projection`); retry delivered. `settings.cloud_identity` is now present.
- Live `/admin` on `98212c18c` does **not** consume `?ott=` in the loader. A healthy settings load `requireWorkspaceRole`s first and 307s to `/?auth=signin&callbackUrl=/admin`, dropping the token. Client `OttHandler` never runs. First-open error page (`loop-evidence/t1e/05-landed.png`) only kept `?ott=` because settings 500’d before the auth redirect.

Live after this fire (2026-08-14 T17:42Z):

- Docker `31824767863` published `saas` as
  `ghcr.io/quackbackio/quackback@sha256:1249693eb22277381fbe450cd49368216af1254661e9502870aaa64e7f8c819d`
  from `6f255842f`.
- `source.image` set on web/worker/cron-hourly/cron-daily/migrator. Latest
  `serviceInstanceDeployV2` SUCCESS with matching `meta.imageDigest`:
  web `2cf7c84e`, worker `de43e4a4`, hourly `a11f9047`, daily `77511e68`,
  migrator `5ed6f587`. All `us-east4-eqdc4a`. Ready 200.
- Live CP `e28c7b8e` (`71e59d9`) mints
  `/auth/open-handoff?ott=&returnTo=/onboarding/workspace`. Confirmed from
  `/app/src/lib/server/tenant-bootstrap-magic-link.ts` on the running
  service. Digest `sha256:29592e95de0e4e5299d591e2ef305b3cf0c13ccca509ccefb2a3978bf1832022`.
  CP remains in `sfo` (unchanged).
- Re-walk of the two existing `ws-*` owners (no new Neon projects):

  | Mailbox                             | Instance                          | Host                                          |
  | ----------------------------------- | --------------------------------- | --------------------------------------------- |
  | `walk-t1e-a7ebad@guerrillamail.com` | `inst_01m00kprbrfzzb19f490wga8q2` | `ws-4a048e07941c5e7840e986c0.quackback.co.uk` |
  | `qb-t1a-7caf14b1@guerrillamail.com` | `inst_01m00kq6cdfzzb19gfjz8pt0s7` | `ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk` |

  Both still `Untitled workspace`, leftover `cp_instances.name=''`,
  onboarding already stamped `product_feedback`. POST `/api/instances/:id/open`
  302s to `https://ws-…/auth/open-handoff?ott=&returnTo=/onboarding/workspace`.
  Expiry and wrong-workspace GETs return the dedicated invalid page, no
  session cookie; the wrong-host token remains on the owner DB.
  Browser consume of a fresh mint then landed on
  `/?auth=signin&callbackUrl=/admin&error=handoff_failed` (shot
  `loop-evidence/t1e-oh/03-after-handoff.png`). Root `OttHandler` still
  treats `?ott=` on `/auth/open-handoff` as a widget portal token and
  races the loader. The route also still used a `createServerFn` RPC,
  the same Host-loss shape `76ef4924b` already removed from `/admin`.
  Rename/storage did not complete (friendly URL never moved; logo key
  stayed null). Details/outcome UI not re-shown because the handoff
  never reached `/onboarding/workspace`.

- Fix `c7009ac91`: consume Open and rename transfer on the incoming
  request via `handoff-cookies.server.ts`; `OttHandler` ignores `/auth/*`.
  Focused tests 14 passed. Docker `31826475187` **failed** import-protection
  (`auth.origin-transfer.tsx` imported `handoff-cookies.server`).
- Fix `78d9f7652`: consume via `createServerOnlyFn` in the route so the
  client bundle never imports `*.server.ts`. Incoming request / Host
  preserved (no RPC). Deleted `handoff-cookies.server.ts`. Focused tests
  13 passed (open-handoff shape 2, ott-handler 2, open-handoff 2,
  origin-transfer.db 7). Local client Vite build passed import-protection;
  SSR failed only on a missing local widget bundle (Docker builds that
  first). Docker `31826887859` (`78d9f7652`) **failed at checkout**, not
  import-protection. Dispatch passed `sha=78d9f7652` (short); checkout
  v6 fetched `refs/heads/78d9f7652*` and exited 1. Re-dispatched
  `31827133552` with `--ref saas` and no `sha` input so checkout uses
  `refs/heads/saas` (`338cb9f99`, includes `78d9f7652`) and tags `saas`.
  Queued 2026-08-14T18:06:48Z. Do not treat `31826887859` as a digest
  source.

Live after this fire (2026-08-14 T18:21Z):

- Docker `31827133552` succeeded from `saas` `338cb9f99` as
  `ghcr.io/quackbackio/quackback@sha256:cd101b2c1339204ce1de77c50083a54fc8a5639233cab8f422b6ed017305d74c`.
- `source.image` + `serviceInstanceDeployV2` SUCCESS, matching
  `meta.imageDigest`, all `us-east4-eqdc4a`:
  web `0c746ce4`, worker `fd9450b6`, hourly `0515ce99`, daily `c48e6569`,
  migrator `73e52375`. Ready 200 on gauntlet and both `ws-*` hosts.
- Re-walk of the same two `ws-*` owners (`t1e-cd` / `t1a-cd`). No new
  Neon. Onboarding `useCase` / `startingPoint` were cleared so details
  and outcome could reappear. Fresh mint still 302s to
  `/auth/open-handoff?ott=&returnTo=/onboarding/workspace`.
  Expiry and wrong-workspace GETs still fail closed (invalid page, no
  session cookie; wrong-host token remains).
- `curl` of a fresh mint: HTTP 307 `Location: /onboarding/workspace`
  plus `__Secure-better-auth.session_token`; token row deleted. A
  follow-up `GET /onboarding/workspace` with that cookie is 200.
- Chromium `page.goto` of the same mint stores the session cookie,
  follows the 307, then `GET /onboarding/workspace` 307s **back** to
  the original `/auth/open-handoff?ott=` (spent). The visible page is
  the dedicated invalid card (`loop-evidence/t1e-cd/03-after-handoff.png`).
  Details / outcome / rename did not run.
- Fix `f75518e47`: a remount that already holds the session continues
  to `returnTo`; the route finishes on a 200 bounce instead of
  `throw redirect`. Replay without a session still fails closed.
  Focused tests 14 passed (open-handoff 3, route shape 2, ott-handler
  2, origin-transfer.db 7). Pushed `saas`. Docker `31829624405`
  dispatched `--ref saas` empty `sha`.

- Docker `31829624405` succeeded from `saas` `f75518e47` as
  `ghcr.io/quackbackio/quackback@sha256:c9fbd88ba6152c8ccd3e04eaf3418554e5991d2f03f55a0d4a9e8913ae3dee46`.
  `source.image` + `serviceInstanceDeployV2` SUCCESS, matching digest,
  all `us-east4-eqdc4a`: web `51e51404`, worker `ef4f782f`, hourly
  `4ffc6944`, daily `feedc9b4`, migrator `81629f7d`. Live chunk
  `auth.open-handoff-CJSBo0Zc.js` contains `location.replace` and
  “Opening your workspace”.
- Chromium consume on `ws-4a048e…` now lands on
  `/onboarding/workspace` with session cookie and “Make this workspace
  yours” (`loop-evidence/t1e-cd/04-details.png`). Expiry / wrong-workspace
  / replay without a session still fail closed.
- Same-browser walk then showed the outcome question
  (`05-outcome.png`) and the product-feedback starter (`06-after-details.png`).
  `/admin/settings/general` is still gated until the starter step is
  finished, so rename / old-host redirect / `/api/storage/…` did not
  complete. A later OTP wait hit the login form (likely rate-limited).
  Do not hammer CP sign-in.

### Critic (2026-08-14, remount fix `f75518e47`)

PASS — tip is `f75518e47`, consume stays on the request with no
`throw redirect`, required tests 7/7, live missing/dummy OTTs fail
closed with no session cookie. Live image at critic time was still
`cd101b2c` (`338cb9f99`); that cannot close the browser walk. The
`c9fbd88b` deploy above landed after that verdict.

Do **not** start custom domains or the billing live bar. Reuse the two
`ws-*` rows. Finish starter → rename / storage on those hosts. Do not
mint more Neon projects.

Live after this fire (2026-08-14 T19:25Z):

- App `689c99d13` always issues same-origin `PUT /api/storage/<key>`
  upload URLs (no object-store CORS). Focused tests 76 passed
  (matrix 10, scoped-client 16, proxy-upload 9, tenant-placement 16,
  uploads 9, unscoped 8, asset-url 8). Docker `31832193195` published
  `ghcr.io/quackbackio/quackback@sha256:8d9da3be4870f2594b0a73937842688f6797936657a7671823ccd4ed375cafcb`.
  `source.image` + `serviceInstanceDeployV2` SUCCESS, matching digest,
  `us-east4-eqdc4a`: web `30386b1e`, worker `5d467cd6`, hourly
  `6cbbe8b0`, daily `89afc3ef`, migrator `ee8160b9`. Ready 200.
- Live fleet needed `S3_PROXY=true` on the prior image and
  `QUACKBACK_CONTROL_PLANE_URL=https://cp.quackback.co.uk` on web
  (worker skip-deploys). Identity rename 502'd as “temporarily
  unavailable” until the CP origin was set. No new Neon. No CP OTPs;
  Open minted via `mintOwnerHandoff`.
- Same two `ws-*` owners:

  | Mailbox                             | Instance                          | System host                                   | Canonical now                 |
  | ----------------------------------- | --------------------------------- | --------------------------------------------- | ----------------------------- |
  | `walk-t1e-a7ebad@guerrillamail.com` | `inst_01m00kprbrfzzb19f490wga8q2` | `ws-4a048e07941c5e7840e986c0.quackback.co.uk` | `northfa99f0.quackback.co.uk` |
  | `qb-t1a-7caf14b1@guerrillamail.com` | `inst_01m00kq6cdfzzb19gfjz8pt0s7` | `ws-bf8e1c4affe270eb5a6dda1a.quackback.co.uk` | `south63792f.quackback.co.uk` |

  t1a Chromium: skippable details (`04-details.png`) → outcome
  (`05-outcome.png`) → existing-board starter (`06-starter.png`) →
  complete → branding logo → General rename. Session survived on
  `south63792f` (`11-renamed.png`). Stored logo
  `/api/storage/logos/2026/08/277bef86-…-logo.png` unchanged across
  rename.
  t1e: starter already configured; second rename
  `northe0d78f` → `northfa99f0`, session survived (`11-renamed.png`).
  Stored logo `/api/storage/logos/2026/08/a5aa6244-…-logo.png`
  unchanged. Previous friendly `GET https://northe0d78f.quackback.co.uk/`
  → 308 `https://northfa99f0.quackback.co.uk/` (path preserved on
  `/admin/settings/general`). System host stays active (immutable).
  Shots: `loop-evidence/t1e-rn/`, `loop-evidence/t1a-rn/`.

### Critic (2026-08-14, rename/storage `689c99d13`)

PASS — old friendly `northe0d78f` 308s to `northfa99f0` (path preserved);
both logos 200 at `/api/storage/…` (not a friendly object-store host);
system `ws-*` hosts still serve. Critic hit health 200, both canonical
homes, both system homes, both logo URLs. It did not re-walk Open/OTP
or independently read Railway `meta.imageDigest` (GraphQL blocked);
serving digest `sha256:8d9da3be…` on web `30386b1e` was already listed
by `list-deployments` this fire. Session survival was builder-walk
evidence, not re-exercised.

## Track 3/5 live billing (2026-08-14)

First unfinished bar among tracks 3–5. Checkout cannot be live-proved:
`STRIPE_SECRET_KEY` is present and `sk_test_*` but Stripe returns
`Invalid API Key`. Paid `cp_plans` rows have no monthly/yearly price
ids. `SEED_DATABASE` is unset on the CP. A full seed with
`CLUSTER_ENV=gauntlet` would also create the public demo user unless
`SEED_DEMO_USER=false`. Do not rotate the key from this loop.

Trial activation does not need Stripe. t1a (`south63792f`,
`inst_01m00kq6cdfzzb19gfjz8pt0s7`) already started a Pro trial at
starter completion (`2026-08-14T19:24:04.355Z` → `2026-08-28T19:24:04.355Z`,
projection v2 delivered, no provider fields). t1e (`northfa99f0`,
`inst_01m00kprbrfzzb19f490wga8q2`) completed its starter at
`2026-08-14T19:04:59.476Z` before the workspace could reach the CP, so
it stayed on Free v1.

Live through `POST https://cp.quackback.co.uk/api/v1/internal/billing/activate-trial`
with the instance credential (no workspace id in the body):

| Call                                  | Result                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| no bearer                             | 401 `unauthorized`                                                                          |
| t1e + `instanceId`/`returnUrl` extras | 400 `Invalid input`                                                                         |
| t1e configured-board evidence         | 201 `started`, trial `2026-08-14T19:44:24.774Z` → `2026-08-28T19:44:24.774Z`, projection v2 |
| same t1e evidence again               | 200 `already_started`, same dates                                                           |
| t1a original evidence                 | 200 `already_started`, original t1a dates unchanged                                         |

t1e workspace `settings.cloud` accepted projection v2 (`pro`, same
trial dates, `has_provider=false`). App `57ff32499` retries the same
stamped evidence from admin plan-notice when Cloud is on and no local
trial has landed. Focused tests 20 passed (starter-trial 5,
setup-completion 8, plan-notice 7). That retry is not in the live
image yet.

### Critic (2026-08-14, starter trial)

PASS — both `ws-*` workspaces have one immutable Pro trial (configured
board, projection v2 delivered, no provider ids); unauthenticated
activate-trial fails closed.

HTTP: no bearer and dummy bearer → 401 `unauthorized`. Both canonical
and both system hosts `/api/health` 200; `/` 307 `/?sort=trending`.
t1e trial `2026-08-14T19:44:24.774Z` → `2026-08-28T19:44:24.774Z`.
t1a trial `2026-08-14T19:24:04.355Z` → `2026-08-28T19:24:04.355Z`.
Critic did not replay with an instance bearer (tables already show one
event and one anchor each) and did not re-read image digests.

Docker `31834774523` dispatched `--ref saas` for `57ff32499` (includes
the ledger commit). Not waited; retry is not required for this unit’s
live proof.

Live after this fire (2026-08-14 T19:55Z):

- Docker `31834774523` succeeded from `saas` `0c42bbe1f` (includes
  `57ff32499`) as
  `ghcr.io/quackbackio/quackback@sha256:703eca7db7c22362e7ea5beed5d35a2574e8cb561d1dd078e5e8c7c311a51af2`.
- `source.image` + `serviceInstanceDeployV2` SUCCESS, matching
  `meta.imageDigest`, all `us-east4-eqdc4a`:
  web `d525ae4f`, worker `83a05e54`, hourly `14f7061d`, daily
  `49d5c98c`, migrator `bce46043`. Worker/crons first landed on `sfo`
  and were re-pinned then re-deployed V2; digest unchanged.
- Ready 200 on gauntlet, `northfa99f0`, `south63792f`; health 200 on
  both immutable `ws-*` hosts.
- Live web bundle contains `reportStarterTrialIfDue` in
  `/app/.output/server/_ssr/starter-trial-BOpCsSuc.mjs` (skips when
  `trialStartedAt` is already set). Both `ws-*` workspaces already
  hold a trial, so the helper is a no-op on those hosts.

### Critic (2026-08-14, retry-image deploy `0c42bbe1f`)

PASS — all five SUCCESS deploys run
`sha256:703eca7db7c22362e7ea5beed5d35a2574e8cb561d1dd078e5e8c7c311a51af2`
in `us-east4-eqdc4a` (not sfo); five health URLs 200; live web
filesystem defines and calls `reportStarterTrialIfDue`.

| role     | deployment | digest     | region          |
| -------- | ---------- | ---------- | --------------- |
| web      | `d525ae4f` | `703eca7d` | us-east4-eqdc4a |
| worker   | `83a05e54` | `703eca7d` | us-east4-eqdc4a |
| hourly   | `14f7061d` | `703eca7d` | us-east4-eqdc4a |
| daily    | `49d5c98c` | `703eca7d` | us-east4-eqdc4a |
| migrator | `bce46043` | `703eca7d` | us-east4-eqdc4a |

HTTP 200: gauntlet `/api/health/ready` (`role: web`),
`northfa99f0` ready, `south63792f` ready, both `ws-*` `/api/health`.
Live web `d525ae4f` replica `50b9fc32`:
`starter-trial-BOpCsSuc.mjs:26` defines `reportStarterTrialIfDue`;
`plan-notice-HQY-UayT.mjs:29-30` imports and awaits it. Critic did
not start a new trial (both workspaces already have one).

## Track 3 live checkout (2026-08-14)

Operator unblocked Stripe **test** on Development (`acct_1SeJT1Rbu1DLQxj3`,
`sk_test_` / `pk_test_`). Paid `cp_plans` now have monthly+yearly
`price_` ids (`qb_*_monthly` / `qb_*_yearly`). CP redeployed SUCCESS
`f135274f` (`sha256:a005414f…`, code still `71e59d9`). Walk3 workspace
webhook disabled. No new Neon. No live key.

Live through `POST https://cp.quackback.co.uk/api/v1/internal/billing/session`
with the instance credential (no workspace id or return URL in the body):

| Call                                                               | Result                                            |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| no bearer / dummy bearer                                           | 401 `unauthorized`                                |
| extras `returnUrl` + `instanceId`                                  | 400 `Invalid input`                               |
| `planId: free`                                                     | 400 `Invalid input`                               |
| t1a `{ action: checkout, planId: growth, billingPeriod: monthly }` | 200 `checkout.stripe.com` `cs_test_`              |
| t1e same body                                                      | 200; Stripe metadata `instanceId` is t1e, not t1a |
| t1a `{ action: portal }` after customer create                     | 200 `billing.stripe.com`                          |

t1a Stripe session (retrieved, test mode):

- `kind=workspace_subscription`
- `instanceId=inst_01m00kq6cdfzzb19gfjz8pt0s7` (existing)
- `success_url=https://south63792f.quackback.co.uk/admin/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`
- `cancel_url=https://south63792f.quackback.co.uk/admin/settings/billing?checkout=cancelled`
- instance count 16 → 16

t1e return URLs are `https://northfa99f0.quackback.co.uk/admin/settings/billing?checkout=…`.

Hosted pages (Chromium): `loop-evidence/t3-checkout/01-hosted-checkout.png`
(Subscribe to Quackback Growth $32.00 / month, sandbox, owner email
prefilled), `02-hosted-portal.png` (Stripe billing portal, no card yet).
Pay-and-subscribe was filled with the test card but did not leave
Checkout in the headless run; webhook finalize is not claimed.

Workspace `POST https://south63792f.quackback.co.uk/api/billing/session`
with browser `Origin: https://…` was 403 `invalid_origin` on
`703eca7d`: `request.url` is `http://` behind TLS termination. App
`635cdb149` compares Origin host to Host instead. Focused tests 4
passed. That commit is now live as `139a4a8c` (see below).

### Critic (2026-08-14, test-mode checkout/portal)

PASS — independent live POST to the instance-scoped gateway created
test-mode checkout and portal sessions on the existing `ws-*` rows;
return URLs match the registry; metadata does not create a workspace.

HTTP/Stripe (`loop-evidence/t3-critic/facts.json`, `result.json`):
`sk_test_`; no bearer and dummy bearer → 401 `unauthorized`; extras
`returnUrl`/`instanceId` → 400 `Invalid input`; t1a and t1e checkout
200 `checkout.stripe.com` `cs_test_` `livemode=false`
`kind=workspace_subscription` with each workspace's own `instanceId`;
success/cancel URLs are `https://south63792f…` / `https://northfa99f0…`
`/admin/settings/billing?checkout=…`; t1a portal 200
`billing.stripe.com`; instance count 16→16, same id set, `createdIds`
empty. Hosted GET: checkout title “Stripe Checkout”, portal
`billing.stripe.com`. Critic did not complete a payment. An explore
critic without a shell only hit public GETs and is discarded.

Live after this fire (2026-08-14 T20:29Z):

- Docker `31837417742` succeeded from `saas` `6d4d9f252` (includes
  Origin-fix `635cdb149`) as
  `ghcr.io/quackbackio/quackback@sha256:139a4a8c6873d14c1d4cc129d8f3e2d286ccaaea90e2ab0e86766944b8219570`.
- `source.image` + `serviceInstanceDeployV2` SUCCESS, matching
  `meta.imageDigest`, all `us-east4-eqdc4a`:
  web `683a4b07`, worker `604419ed`, hourly `e7f7170e`, daily
  `3c34090e`, migrator `6bd4b4d1`. Ready 200 on gauntlet, both
  `ws-*` system hosts, and both friendly hosts.
- Live web `683a4b07` replica defines `originMatchesRequestHost` in
  `/app/.output/server/_ssr/router-CetLJkQa.mjs` and compares Origin
  to `x-forwarded-host` / `Host`.
- Workspace Upgrade form on t1a (`south63792f`,
  `inst_01m00kq6cdfzzb19gfjz8pt0s7`):

  | Call                                           | Result                                           |
  | ---------------------------------------------- | ------------------------------------------------ |
  | `Origin: https://south63792f…`, no session     | 500 `HTTPError` (origin accepted; auth required) |
  | `Origin: https://attacker.test`, owner session | 403 `invalid_origin`                             |
  | no Origin                                      | 403 `invalid_origin`                             |
  | `Origin: https://south63792f…`, owner session  | **303** `checkout.stripe.com` `/c/pay/cs_test_…` |

  Instance count 16 → 16. No new Neon. No live Stripe key.
  Transcript: `loop-evidence/t3-form-303/facts.json`.

### Critic (2026-08-14, workspace form 303 `635cdb149` / `139a4a8c`)

PASS — live owner `POST /api/billing/session` with https Origin 303s to
test Checkout on existing t1a; foreign/missing Origin 403
`invalid_origin`; five roles on `sha256:139a4a8c…` in
`us-east4-eqdc4a` only; instances 16→16.

Independent mint (not builder cookies). HTTP:
`loop-evidence/t3-form-303/critic.md`, `critic-result.json`. Health
200 on gauntlet, both friendly hosts, both `ws-*`. Owner +
`Origin: https://south63792f…` → 303 `checkout.stripe.com`
`/c/pay/cs_test_…`. Stripe retrieve `livemode=false`
`kind=workspace_subscription`
`instanceId=inst_01m00kq6cdfzzb19gfjz8pt0s7`. Critic did not pay.

## Track 3 live payment (2026-08-14)

Fleet lane this fire: `635cdb149` already live (`683a4b07` /
`sha256:139a4a8c…`, `us-east4-eqdc4a` only). No deploy.

One test-mode payment on existing t1a (`south63792f`,
`inst_01m00kq6cdfzzb19gfjz8pt0s7`). No new Neon. No live key.

- CP webhook `https://cp.quackback.co.uk/api/billing/webhook` enabled,
  `checkout.session.completed` on. Walk3 workspace webhook still disabled.
- Gateway `POST /api/v1/internal/billing/session` `{ action: checkout,
planId: growth, billingPeriod: monthly }` → 200 `checkout.stripe.com`
  `cs_test_`. Stripe retrieve: `livemode=false`,
  `kind=workspace_subscription`, `instanceId=t1a`.
- Hosted Checkout paid with test card 4242 + GB address. Browser left
  Stripe for `south63792f.quackback.co.uk` (return hit public home
  without an owner session). Shots: `loop-evidence/t3-pay/`.
- Stripe session `complete` / `paid`, subscription `active` (`sub_1U4S…`).
- `checkout.session.completed` and `customer.subscription.created`
  processed on `cp_stripe_webhook_events`.
- t1a `plan_id=growth`, item `si_V4bLN…`, org sub `active`.
- Billing outbox v4 `delivered` `effectivePlan=growth`
  `subscriptionStatus=active` `canManageBilling=true`.
- Workspace `settings.cloud.projection` v4 same commercial fields; no
  provider ids. Trial dates remain historical.
- Instances **16 → 16**. t1a and t1e remain.

### Critic (2026-08-14, test-mode payment + webhook)

PASS — independent retrieve of the `cs_test_` session is complete+paid
on existing t1a; `checkout.session.completed` processed; Growth
projection delivered without provider ids; instances 16.

HTTP: five health URLs 200. Stripe: `livemode=false` `mode=subscription`
`status=complete` `payment_status=paid` `kind=workspace_subscription`
`instanceId=inst_01m00kq6cdfzzb19gfjz8pt0s7` `planId=growth`
`subscriptionStatus=active` success host `south63792f`. SQL:
`plan_id=growth`, has item + sub, org `active`, outbox v4 delivered,
workspace projection v4 `effectivePlan=growth` `hasProviderId=false`.
`loop-evidence/t3-pay/critic.md`. Did not pay again.

## Per-owner 3-Free cap (local, 2026-08-14)

CP `c5a484d` already on `saas` (no isolated worktree builder). Not
deployed. `countLiveFreeOwnedBy` is ownerEmail + live lifecycle +
unpaid (trial counts as Free). Fourth create is 402
`free_workspace_owner_cap`. Focused tests: 35 passed
(`instance-fn` 21, `create-without-a-plan` 14).

### Critic (2026-08-14, 3-Free cap `c5a484d`)

PASS — focused tests 35/35; 4th Free is 402 with
`free_workspace_owner_cap` and does not insert; trial is Free; paid
item+plan frees a slot; count is `ownerEmail`. Not live (CP still
`71e59d9` / `f135274f`).

## Verify + Track-6 + limits fixer (2026-08-14)

Fleet: `635cdb149` still live (`683a4b07` / `sha256:139a4a8c…`,
`us-east4-eqdc4a`). No 635cdb149 deploy. Stripe-live not repeated.
CP-create still `c5a484d` on `saas`, not deployed. No second builder.

Track-6: deleted web `BILLING_API_KEY`, `BILLING_PRICES`,
`BILLING_WEBHOOK_SECRET` with `--skip-deploys`. Remaining BILLING keys
on web: none. Latest web deploy unchanged `683a4b07`. Worker/crons/
migrator already had none. CP `BILLING_PROJECTION_PRIVATE_KEY` kept.

Verify sweep: FAIL one HIGH. `loop-evidence/verify-2026-08-14/sweep.md`.
Instances 16→16. t1e upgrade 303 `cs_test_`; t1a portal 303; foreign
Origin 403; old friendly 308.

HIGH: t1a/t1e `settings.tier_limits` null + projection present →
`getTierLimits` returned OSS unlimited.

Fixer `b0c13a366` (`loop/cloud-limit-overlay`) merged as `31330d85b`.
`resolveEffectiveTierLimits`: no row + projection uses projection
floor, not OSS. Focused tests 19/19. Critic (re-run on `saas`): 19/19
PASS. Not deployed (Docker not started this fire).

## Next commits

1. ~~**Unit A — deploy the current CP**~~ live was `07d5737e` (`6b42ef3`); current live `e28c7b8e` (`71e59d9`).
2. ~~**Unit B — auto-open when ready**~~ OpeningPane posts `/open` on live.
3. ~~**Unit C — host-independent stored assets**~~ live through `6f255842f` (`sha256:1249693e…`).
4. ~~Deploy `6f255842f` + confirm CP `71e59d9`.~~ Digest and `us-east4-eqdc4a` verified. Live consume still bounced via `OttHandler`.
5. ~~Deploy `f75518e47` (`sha256:c9fbd88b…`).~~ Chromium Open + details + outcome proved.
6. ~~Live rename / old-friendly 308 / `/api/storage/…` src on the two `ws-*` hosts (`689c99d13`, `sha256:8d9da3be…`).~~
7. ~~Live starter trial through the instance-scoped CP gateway on both `ws-*` hosts.~~
8. ~~Live-prove test-mode checkout/portal through the instance-scoped CP
   gateway on existing `ws-*` workspaces.~~ session + hosted pages +
   registry return URLs + no new workspace. Webhook paid-finalize
   still open. Workspace-form 303 is live (`139a4a8c`).
9. ~~Deploy `57ff32499` so a later starter-miss retries from admin plan-notice.~~
   Live `0c42bbe1f` / `sha256:703eca7d…`.
10. ~~Deploy `635cdb149` so the workspace Upgrade form accepts https Origin,
    then live-prove the 303 from `/api/billing/session`.~~ live
    `6d4d9f252` / `sha256:139a4a8c…`.
11. ~~Complete one test-mode payment and prove webhook finalize + projection
    on the existing workspace (metadata must not create one).~~ t1a Growth
    paid; webhook processed; projection v4 delivered; instances 16.
12. **Per-owner cap:** implemented on CP `c5a484d` (tests 35, critic PASS).
    Not deployed. Live 4th-Free 402 still needs a CP deploy (Fleet lane;
    no new Neon unless that live proof requires it).
13. ~~Hosted-product sweep.~~ 2026-08-14 FAIL one HIGH (unlimited
    `getTierLimits` on cloud). Fixer `b0c13a366` merged `31330d85b`,
    tests 19/19. Not in the live image. Re-sweep after deploy.
14. Deploy `31330d85b` (Fleet) so cloud projection limits apply on t1a/t1e.
15. **Track 8 — hosted account operations** (see
    `LOOP-SAAS-FIRST-CUSTOMER.md`). Order:
    8a soft-delete/restore + 3-Free re-check (with or right after
    `c5a484d` deploy); 8b in-product switcher; 8c transfer/leave;
    8d seats + SSO downgrade live row; 8e visible usage; 8f export /
    wipe / delete CP account. No new Neon unless a finding cannot
    be proved on current hosts.
16. Cloudflare for SaaS: operator token stored on CP (skip-deploy).
    Fallback origin `saas-origin.quackback.co.uk` is **active** and
    CNAMEs (proxied) to the pooled Railway web host — not the old
    originless `100::` Worker pattern. Customer CNAME target is
    `customers.quackback.co.uk`. CP client is in `lib/server/cloudflare/`.
    Next: identity gateway add/verify/make-primary/remove + workspace
    Domains card. Do not print the token.
17. Plan & billing page: catalogue + invoices from the control plane
    (`GET /api/v1/internal/billing/catalogue` and `/invoices`). Cards
    use public pricing stickers (annual = 10 months). Workspace holds
    no price list. Not live until CP + app deploy.
18. First-win journeys. Checkout attaches to an existing workspace only.

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
- ~~`settings-fn`, `instance-plan-fn`, `instance-billing-fn`,
  `downgrade-fn`, `cancel-at-period-end-fn`, `org-cancel-fn`,
  `org-billing-audit-fn`, `resume-cascade-suspended-fn`~~ deleted in
  `7230a32`. Keep `org-subscription`, billing operations, admin
  billing-fn, and the billing sweeper. `org-lifecycle-fn` and
  `instance-lifecycle-fn` have no customer UI callers; park until
  admin purge is confirmed to be the only delete path.
- Customer dashboard leftovers that only redirect:
  `dashboard/$orgId/billing`, `.../members`, `.../settings*`. Current
  mail templates point at `/dashboard`. Parked as redirects; delete
  after 2026-11-14.
- ~~`setup.$orgId.tsx` named-create copy~~ removed in `7230a32`. The
  page auto-creates and headings say "Your workspace".
- ~~`cp_instances.name` as customer identity~~ writes `''` in
  `546b26e`. Display name is `cp_workspace_identity` only. Admin
  list coalesces identity, leftover name (walk-\* rows), then
  system hostname. Drop the leftover column after no replica
  SELECTs it.
- ~~`cp_instances.custom_domain*` as a routing source~~ ignored in
  `6836a6a`. New identity uses `cp_workspace_hostname_claims`.
  Columns stay until no replica SELECTs them. Still leftover and
  unread by current code except implicit `SELECT *` / admin-MCP
  display: `r2_bucket_name`, `r2_token_id`, `oidc_client_id`. Drop
  after no replica SELECTs them.
- ~~`login_url` as a customer door~~ mailed no more in `be35af1`.
  Welcome and the billing notice point at `/dashboard` and refuse
  magic-link strings. Dashboard tiles and ReadyPane already POST
  `/api/instances/:id/open`. Bootstrap still writes `login_url` so
  admin-seeded presence (`loginUrlMinted`) stays true. Drop the
  leftover column, the emailed mint, and wizard `loginUrl` plumbing
  after no replica SELECTs them.
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
- ~~Local onboarding fixture still pre-0262 (13 skipped tests).~~
  Local `quackback` and `quackback_test` migrated through `0262` on
  2026-08-14. The 13 bootstrap-claim tests now run (27 onboarding DB
  tests passed). Recreate those databases only via `bun run db:migrate`.

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

Standing program: `LOOP-VERIFY.md` (Verify lane + HIGH SIGNAL Fixers).
Sweep 2026-08-14: `loop-evidence/verify-2026-08-14/sweep.md` **FAIL**
one HIGH (cloud unlimited overlay). Fixer merged, not deployed.

- Least-restrictive numeric limit overlay and exact-expiry tests (unit tests exist).
  Live: Free cap refuses with a named plan; paid overlay lifts it;
  downgrade leaves existing over-cap resources removable.
- Plan change / downgrade / cancel / update-card through workspace
  Plan & billing (checkout + portal). Upgrade 303 and one paid
  finalize are live on t1a. Catalogue cards + invoice list are
  **code** (`2fb9488` / `6418785c8`), not live. After deploy: four
  cards, annual default, invoices table, no local price list.
- ~~Cross-workspace checkout session metadata.~~ t1e session names t1e;
  extras `instanceId` cannot retarget. Paid webhook on t1a named t1a;
  t1e was not paid. Isolation of a second paid workspace still open.
- Control-plane webhook replay and outbox retry.
- ~~Created/configured-only trial activation and immutable anchor.~~ live on both `ws-*` hosts.
- Control-plane outage behavior for normal use and billing actions. App retry
  helper is live (`57ff32499` in image `703eca7d`); both current `ws-*`
  workspaces already have a trial so the helper skips.
- Fresh-browser journeys for every onboarding outcome and self-hosted mode.
  Ready must have a primary enter action (local onboarding fix still
  uncommitted on `saas`).
- Zero-input first-workspace creation and retry after interrupted provisioning.
- Live rename handoff, old-host redirect, and session survival on a new
  generated host. Local replay/expiry/wrong-host and pinned asset-origin
  tests passed (`1add15b16`, `4a1e97b`).
- Cloud settings contract: General (name/URL), Plan & billing, Domains
  (surface + CP gateway; live provider skipped), Emails without platform
  keys. A cloud workspace must not use the Help Center local domain
  writer as the cloud manager.
- Track 8: restore vs 3-Free, switcher, transfer/leave, seats, SSO
  downgrade, visible usage, export/wipe/account delete.
- Custom-domain ownership, DNS, hostname/SSL readiness, make-primary, removal,
  provider retry, and cross-workspace isolation. Provider client and
  fallback origin are ready (`de0b038`). Workspace Domains card and
  identity-gateway wiring are the next builder. Token is on CP only.

## Blockers

Stripe **test** payment + webhook finalize is live on t1a (Growth,
projection v4, instances 16). Unused web `BILLING_*` vars removed
(`--skip-deploys`; deploy still `683a4b07`). Remaining: deploy limits
overlay `31330d85b`; deploy CP `c5a484d` + live 4th-Free 402. Walk3
workspace webhook stays disabled. Cloudflare for SaaS provider is
started (`0302c1d00`); this fire did not wire the Domains card.

The identity/billing pair is otherwise deployed. Further deploys are
incremental. Live app `6d4d9f252` / `sha256:139a4a8c…`. Live CP
`f135274f` / `sha256:a005414f…`. Local CP `c5a484d` waits for a Fleet
deploy.

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
