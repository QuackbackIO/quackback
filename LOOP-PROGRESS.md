# First-customer Loop Progress

## 2026-08-17 — CP signup → paid Growth → custom domain

Operator asked to clean `t1a-cd` and prove the stranger path on a
new tenant. `t1a-cd.mortondev.com` is unregistered again (522);
south still 307 Track1 Alpha.

Playwright MCP is in `~/.grok/config.toml` (`npx @playwright/mcp@latest`,
headless/isolated/chromium). This session did not load its tools;
the walk used the same Chromium via local Playwright.

**New tenant** `inst_01m07qdz94fvh9rsmdvp6c12dz`
`ws-a988a63c3ebd7dd2b3e40a9f.quackback.co.uk` (instances 20→21).

| Step                        | Result                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------- |
| CP `/signup` + OTP          | landed, workspace provisioned                                                      |
| Free Domains                | Upgrade to Growth card; identity add **402** `Custom domains are a Growth feature` |
| Test checkout Growth        | **303** `cs_test_`; Pay completed; `plan_id=growth`                                |
| First add after pay         | **402** — domain gate read leftover org Stripe columns                             |
| Fix                         | CP `e2e9d7a` live `4b2b2ac6` uses instance subscription                            |
| Add `walk-cd.mortondev.com` | **200**; cert ready **25s**                                                        |
| Visitor GET                 | **307** → **200** `Feedback - Untitled workspace` `x-quackback-saas-edge: 1`       |
| South                       | still first-party **307**                                                          |

Domain left attached so the operator can visit
`https://walk-cd.mortondev.com/`.

## 2026-08-17 — custom-domain serve (Worker-as-origin)

Builder + live E2E on `saas`. The 522 was not HMAC or Railway
registration: Cloudflare for SaaS only invokes a Worker on custom
hosts when the fallback is originless and the zone catch-all route
is present. That path is now live and proved.

| Unit                       | Sha                       | Critic    | Live?                                                     |
| -------------------------- | ------------------------- | --------- | --------------------------------------------------------- |
| App HMAC + env-only hosts  | `d08e55cd1` / `344c80050` | this fire | **yes** `00c94934` / `sha256:a89fa4bb…` `us-east4-eqdc4a` |
| Worker resolveCustomerHost | CP `3b7cbb1` (Worker)     | this fire | **yes** `quackback-saas-origin`                           |
| Zone catch-all on create   | CP `b0b53a3`              | this fire | **yes** `f52e8643` SUCCESS (sfo)                          |

Independent critic **PASS** (`custom-domain-critic-2.md`) on the same
pair after CP `f52e8643` (`sha256:734f3f1a…`): add **200**, cert **36s**,
custom host **307 → 200** Track1 Alpha with `x-quackback-saas-edge: 1`,
t1e **409**, forged Railway header **404** Unknown workspace, remove
restores south, instances 20→20.

**Live E2E PASS** (`loop-evidence/this-fire/custom-domain-e2e.md`):

- Fallback `saas-fallback.quackback.co.uk` **active**, AAAA `100::` proxied.
- Worker routes: catch-all + `saas-fallback.quackback.co.uk/*`.
- t1a add `t1a-cd.mortondev.com` **200**; cert ready **37s**; t1e same host **409**.
- `GET https://t1a-cd.mortondev.com/` **307** `/?sort=trending` then **200**
  `Feedback - Track1 Alpha` with `x-quackback-saas-edge: 1`.
- South first-party stayed **307** → Track1 Alpha (`railway-hikari`, no Worker).
- Forged customer-host header on the Railway origin → **307** `/login`, not the workspace.
- remove **200**; canonical south restored; custom host **522** after CF delete.
- Instances **20 → 20**. Did not `apply` `.railway/railway.ts`. No Neon.

Custom domains are no longer blocked on hostname/certificate readiness.

**Plan-matrix §H** last signed **FAIL** on `e48af8e3` (MCP/workflows UI, pricing
page). Not this unit.

## 2026-08-17 — channels + email spec (operator named this unit)

Builder+critic on `saas` (not a piece branch). Commits pushed:

| Unit                      | Sha                             | Critic                     | Live?                               |
| ------------------------- | ------------------------------- | -------------------------- | ----------------------------------- |
| M1 thread & humanize      | `ec8421444` + fixer `3fbbb4670` | PASS_WITH_GAPS then fixer  | **yes** in `910244e5` / `57068471`  |
| M2 descriptor + adapter   | `e7c6509c6`                     | PASS_WITH_GAPS             | **yes** same digest                 |
| M3 close + ledger + meter | `0874a9c9d` + `ca44e679e`       | FAIL then fixer; live PASS | **yes** (0265 on enrolled DBs)      |
| M4 settings IA + UI       | `4f92f96dc` + `a7683e137`       | PASS_WITH_GAPS             | **yes**                             |
| M5 polish + ack           | `de0eed156`                     | PASS_WITH_GAPS             | **yes**                             |
| M6 extensibility          | `7a4654b1d` + `c33fcda30`       | PASS_WITH_GAPS             | **yes** (0266/0267 on enrolled DBs) |
| TypeID uuid SQL           | `daf740885`                     | needed for 0266 FK         | **yes** (applied before pin)        |
| Import-protection sink    | `fac1beed8`                     | needed for Docker          | **yes** tip                         |
| Ledger notes              | `155177c9b` / `a1fca4ef2`       | n/a                        | skip-deploy (docs)                  |

**This fire (Fleet, 2026-08-17):** 0265–0267 applied, then pin + live critic.

- Blocked half-written `inst_01m00mqr1zfzzb19nevwzer2hr` (no servable registry record).
- First `set-target 0267` + run **failed** on all 18: `channel_threads.channel_account_id` was `text` vs `channel_accounts.id` uuid. Nothing applied (transactional). `daf740885` stores TypeID columns as uuid.
- Re-run: claimed=18 reconciled=18, ledger 240→243, current **0267**, post=true. `MIN_SCHEMA_VERSION` still `0258`.
- Docker `32008528009` FAILED import-protection (`start.ts` → `email-log.sink` → `db`). `fac1beed8` registers the sink from `server.ts`. Redispatch `32009201320` SUCCESS from `fac1beed8` as `sha256:910244e58bcf1c195363a971cbaa54d420d978a61cd4d3a5dc6a29dd8f65ce79`.
- `source.image` + `redeploy --from-source`. Matching `meta.imageDigest`, web region only `us-east4-eqdc4a`:

  | role     | deployment | digest     | region            |
  | -------- | ---------- | ---------- | ----------------- |
  | web      | `57068471` | `910244e5` | `us-east4-eqdc4a` |
  | worker   | `a71325a8` | `910244e5` | `us-east4-eqdc4a` |
  | hourly   | `72676920` | `910244e5` | `us-east4-eqdc4a` |
  | daily    | `5c904fa3` | `910244e5` | `us-east4-eqdc4a` |
  | migrator | `ba0bfb0b` | `910244e5` | `us-east4-eqdc4a` |

- Ready 200 on gauntlet, `south63792f`, `northfa99f0`.
- Live critic **PASS** (`channels-email-critic.md` + `.json`):
  independent walk on t1a. Unauth Channels 307 named sign-in; gauntlet
  404 Unknown workspace; authed hub/messenger/email **200** (Email
  inbound + auto-ack + “No email recorded yet.”; no email_log 500);
  conversations **307** → messenger; inbox **200**. Settings nav
  Channels → `/admin/settings/channels`. Instances 20→20. Named skip:
  no outbound mailbox probe.
- CP unchanged `108c480c` (`sfo`).
- Did not `apply` `.railway/railway.ts`. `APP_IMAGE` pin updated in the file to match live.

App `saas` tip `fac1beed8`. CP `saas` tip `5359852`.

## 2026-08-17 — remaining items (builder+critic)

Operator authorized `mortondev.com` subdomains. DNS-only CNAME
`t1a-cd.mortondev.com` → `customers.quackback.co.uk` created (not proxied).
Custom-domain live critic in flight.

**Verify** on `910244e5` **FAIL** (`sweep-910244e5.md`): live CP
projections omitted `emailsPerMonth`, so `parseBillingProjection`
returned null. Workspace billing POSTs **403**
`billing_action_unavailable`; Free export **200** CSV (OSS unlimited).

**Fixer (HIGH):** app `3dff45137` accepts nine-key projections (missing
`emailsPerMonth` = unlimited). CP `c4ebe3d` projects the key as null.
Docker `32011761628` SUCCESS `sha256:a856b308…`. Web `4ebf7d43` SUCCESS
`us-east4-eqdc4a`. CP `d9eb0196` SUCCESS.

Live re-prove: t1a portal **303** `billing.stripe.com`; t1a Change-to-Scale
**303** confirm; t7 authed `GET /api/export` **402**
`features.analyticsExports`.

SNS + inbox now live as `sha256:84f4e13d…` web `e48af8e3`.

**Plan-matrix §H** on live `e48af8e3` / `sha256:84f4e13d…` **FAIL**
(`plan-matrix-a856b308.md`). Overlay HIGHs from `910244e5` are gone
(t1a portal 303; t7 export 402). New HIGHs: Free t7 MCP enable and
New workflow have no plan CTA; `quackback.io/pricing` still disagrees
with CP enforcement. Instances 20→20.

**Custom domains:** **PASS** 2026-08-17. Originless fallback
`saas-fallback.quackback.co.uk` + zone catch-all Worker route. Visitor
GET on `t1a-cd.mortondev.com` is **200** Track1 Alpha with
`x-quackback-saas-edge: 1`. See fire note above.

---

# First-customer Loop Progress (historical)

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

- Workspace tip: `fac1beed8` **live** as web `57068471` /
  `sha256:910244e58bcf1c195363a971cbaa54d420d978a61cd4d3a5dc6a29dd8f65ce79`
  (`us-east4-eqdc4a`). Docker `32009201320` SUCCESS. Channels/Email
  critic **PASS** (`this-fire/channels-email-critic.md`). Enrolled
  workspace DBs at `0267`. Verify / §H last signed on the older
  `895b942d` pair.
- Control plane tip `5359852` live as `108c480c` (sfo). SQL `0069`
  still applied. P3 restore critic remains **PASS** on the earlier
  `9030705d` / `c208c06` pair (`this-fire/p3-restore-critic.md`).
- Last known deployed workspace: `fac1beed8` / `sha256:910244e5…`
  (2026-08-17) web `57068471` SUCCESS, region `us-east4-eqdc4a`.
  Docker `32009201320`.
- Last known deployed control plane: `108c480c` / `5359852` live
  (sfo). SQL `0069` still applied.

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

| Track                            | Status                                                                                                     | Evidence                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0 contextual activation          | implemented, focused verification passed                                                                   | `d2b8accca`, `029727e26`                                                                                 |
| 1 zero-input create + identity   | live rename + stored `/api/storage` src + old-friendly 308 on `689c99d13`; two-mailbox Open already proved | see “Track 1 live walk (2026-08-14)”                                                                     |
| 2 focused widget activation      | implemented, focused verification passed                                                                   | `13df888fa`                                                                                              |
| 3 CP billing foundation          | live test-mode **payment** + webhook finalize on existing t1a; checkout/portal + form 303 already proved   | CP `f135274f` / `71e59d9`; app `635cdb149` / `139a4a8c`; see “Track 3 live payment (2026-08-14)”         |
| 4 workspace projection + gateway | paid Growth projection v4 on t1a; catalogue+invoices **code** landed, not live                             | projection v4; CP `2fb9488`; app `6418785c8`                                                             |
| 5 authoritative starter trial    | live Pro trial on both `ws-*` hosts; retry helper now in live image `703eca7d`                             | CP `2fa8a08`, `710ab09`; app `57ff32499` deployed `0c42bbe1f`; see “Track 3/5 live billing (2026-08-14)” |
| 6 remove workspace billing       | implementation complete; boundary scan **PASS**                                                            | `loop-evidence/track6-scan/critic.md`; `BILLING_*` gone from fleet roles                                 |
| 6b remove stale SaaS code        | leftover `custom_domain*` / `r2_*` dropped in `0069`; name/login_url/oidc/billing columns stay             | CP `449bd98`; earlier `e2219f5`, `7230a32`, `546b26e`, `6836a6a`, `be35af1`                              |
| 7 PLG + first-win proof          | product-feedback **live** on t1a; support + HC **live** on existing hosts; self-host local                 | `52c1ab397`; `loop-evidence/t7-first-win/live-existing/`                                                 |
| 8 hosted account operations      | 8a–8f live                                                                                                 | 8f app `371883f5` / `e22e3884e`; CP `9aaa6ff2` / `940c984`                                               |

## Pickup for critics and later fires

Use this table. Do not rediscover work that already has a sha. Do not
print the Cloudflare token. Preserve uncommitted onboarding files.

| Unit                                | Where        | Sha                                                                               | Live?                                      | Critic should prove                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------ | --------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ready CTA + required cloud URL      | app          | `1a39cd7d7`                                                                       | **yes** `02cb4329`                         | Ready always has a primary button (Open your board / launch plan). Cloud URL required; Continue disabled without it; no Skip; no `ws-*` prefilled or printed by the field. Tests: `cloud-details-goal`, `activation-action`, `platform-label`.                                        |
| 3-Free create cap                   | CP           | `c5a484d`                                                                         | **yes** `80c8301e`                         | 1–3 Free ok; 4th 402 `free_workspace_owner_cap`; paid unlimited. **8a** restore at 3 live **402** same reason (temps, no Neon) on `7cecf06d` / `895b942d`. `t8a-restore-critic.md`.                                                                                                   |
| Restore refusal stays on dashboard  | CP           | `c208c06`                                                                         | **yes** `9030705d` / `sha256:d84fd27c…`    | Form POST restore at 3-Free **303** `/dashboard?notice=free_workspace_owner_cap` (not JSON 402). Dashboard 200 alert copy. Trash not restored. `p3-restore-critic.md`.                                                                                                                |
| Limits overlay                      | app          | `31330d85b` / `b0c13a366`                                                         | **yes** `cb186135`                         | Cloud workspace with a projection and no `tier_limits` row is **not** OSS unlimited. Re-sweep row 15 PASS.                                                                                                                                                                            |
| CF for SaaS origin + client         | zone + CP    | `de0b038`; fallback **active**                                                    | token on CP, skip-deploy                   | Fallback `saas-origin.quackback.co.uk` CNAME to Railway (not `100::`). Customer target `customers.quackback.co.uk`. Client create/get/delete; no provider ids in projections.                                                                                                         |
| Identity gateway + Domains card     | CP + app     | CP `449bd98` / `69cb0353`; app `74024a9cb` / `59da45c2`                           | **yes** in `40be439d` / `753d3b86`         | t1a `/admin/settings/domains` 200: Custom domain + Add domain + Domains nav; no Growth lock on Pro. SQL `0069` live. Live add/cert still a later probe. Evidence `loop-evidence/domains-live.json`.                                                                                   |
| CP list official + custom hosts     | CP           | `4ad81fc`                                                                         | **yes** `4a5ea8d7` / `sha256:43e28d87…`    | Dashboard tiles print identity `platform_hostname` and ready custom hosts. Generated `ws-*` omitted. t1a live: `south63792f.quackback.co.uk` present, no `ws-*`. No custom rows yet. Tests: one-screen 11, list-addresses 6, siblings 26.                                             |
| Upgrade offer SSR                   | app          | `a8c673417`                                                                       | **yes** `035205ad` / `sha256:52a2ae7d…`    | First HTML includes catalogue price and period toggle. t7 Free: integrations Pro `$49`, macros Growth `$25`, audit Scale `$89`, each with `billed yearly`. `upgrade-ssr-critic.md`.                                                                                                   |
| Plan upgrade offer                  | app          | `5834951f7`                                                                       | **yes** `48468c28` / `sha256:b358f971…`    | Access & Security no longer 402s the page. Audit/SSO/Domains share one offer from `billingQueries.catalogue()`. Export 402 opens the same modal. t1a Pro: Portal access 200; audit tab names Scale; Sign-in shows the SSO offer.                                                      |
| Webhooks/workflows/macros/MCP offer | app          | `e56d00b9a`                                                                       | **yes** `7057e905` / `sha256:27c538ec…`    | Free t7: webhook/MCP **Upgrade to Growth** `$25`/`$300`; workflows **Upgrade to Pro** `$49`/`$588`; macros in-route Growth screen. Mixed Developers 200. t1a Access & Security 200 (audit Scale offer). Live JS gates catalogue/checkout on `billingEnabled`. `p2-upgrade-critic.md`. |
| Projection feature overlay          | app          | `4bddea06f`                                                                       | **yes** `fd136d22` / `sha256:cf2a5726…`    | t1a Pro `GET /api/export` **200** CSV; t7 Free **402** `features.analyticsExports`. Integrations Upgrade to Pro on Free, catalog on Pro. Branding save returns TierLimitError copy (not 500). `p4-overlay-critic.md`.                                                                 |
| Same-plan billing 409               | CP + app     | CP `f4e3844` / `7cecf06d`; app `be3e41b01` / `95610fd8`                           | **yes** in `895b942d` / `753d3b86`         | t1a same-plan Pro monthly **409** `already_on_plan` (not 503). Scale **303** `billing.stripe.com`. Origin 403. Evidence `this-fire/ws-already-on-plan.json`.                                                                                                                          |
| Named billing session refusals      | app          | `cb3c65420` / `932a38f9`                                                          | **yes** `895b942d`                         | No-cookie **401** `unauthorized`. t1a cookie on t1e **401** (was 500). Tests 5/5. `this-fire/billing-authz.json`.                                                                                                                                                                     |
| Plan catalogue + invoices           | CP + app     | CP `2fb9488`, app `6418785c8`                                                     | **yes** API; UI in `02cb4329`              | `GET /catalogue` 200 on live. Four cards. **Change to {plan}** must POST checkout with that planId (not a generic portal).                                                                                                                                                            |
| Paid plan switch                    | CP + app     | CP `b7948ee` / `0e8d89a4`; app `717560270` / `1bf7ba8c`                           | **yes**                                    | Existing sub: Stripe confirm session for the target price. Portal config lists every paid price. Upgrades invoice pro-rata now; downgrades wait until period end. Yearly prices map back to the plan.                                                                                 |
| Completed plan change + cancel      | live Stripe  | t1a `inst_01m00kq6cdfzzb19gfjz8pt0s7`                                             | **yes**                                    | Growth → Pro monthly (`always_invoice`); webhook wrote `plan_id=pro`. `cancel_at_period_end` true then cleared. Evidence `loop-evidence/t1a-plan-change.json`. t1a is now Pro paid.                                                                                                   |
| Second paid isolation               | live Stripe  | t1e `inst_01m00kprbrfzzb19f490wga8q2`                                             | **yes**                                    | Was Growth; now **Scale** (`t1e-scale-critic.md`). t1a stays Pro.                                                                                                                                                                                                                     |
| t1e Scale + SSO surface             | live Stripe  | t1e `inst_01m00kprbrfzzb19f490wga8q2`                                             | **yes**                                    | Scale paid; outbox v6; `/sso/new` create fields. No IdP added. `t1e-scale-critic.md`.                                                                                                                                                                                                 |
| t1e period-end Growth schedule      | live Stripe  | t1e `inst_01m00kprbrfzzb19f490wga8q2`                                             | **yes**                                    | Gateway Growth confirm **200** `billing.stripe.com`. Stripe test schedule **active** [scale] then [growth]. CP still Scale. t1a Pro. Instances 19. `t1e-downgrade-critic.md`.                                                                                                         |
| Verify sweep                        | live         | `loop-evidence/verify-2026-08-15/sweep-e20c0eef.md`                               | **PASS 0 HIGH** on `895b942d` / `b7ae7455` | Compact re-sign 11:13Z (Fleet idle). Critic **PASS** `fleet-idle-critic.md`. Prior 10:58Z sign historical.                                                                                                                                                                            |
| Track 8b–8f                         | CP+app saas  | **8a–8f live**                                                                    | **8f yes** `71f78ecb` / `640d5ac1`         | Export + wipe on General; CP account delete 403 with live workspaces.                                                                                                                                                                                                                 |
| Plan-matrix critic                  | live + spec  | `plan-matrix-scale-t1e.md` + `plan-matrix-895b942d.md` + `plan-matrix-free-t7.md` | **PASS** Scale t1e on `895b942d`           | t1a Pro + t1e Scale + t7 Free. `/sso/new` unlocked. No IdP.                                                                                                                                                                                                                           |
| Projection replay / stale / expiry  | live + tests | `this-fire/projection-probes.json`                                                | **yes** `40be439d`                         | Replay 204, stale 409, garbage 401. Paid Growth not dropped by trial clock. Unit exact-expiry 12/12.                                                                                                                                                                                  |
| CP outage (web origin)              | live         | `this-fire/cp-outage-critic.md`                                                   | **yes** `e20c0eef` / `895b942d`            | Inbox 200; billing 503 retry copy; restore 303/409. Same digest. CP process not stopped.                                                                                                                                                                                              |
| Unauth delete/restore               | CP           | `ef31b2a` / `3a9bc4ee`                                                            | **yes** `aed43943`                         | No-cookie POST delete/restore **303** `/auth/login` (was 500). Tests 6/6. `lifecycle-auth-critic.md`.                                                                                                                                                                                 |
| Product-feedback first-win          | app          | `52c1ab397`                                                                       | **yes** `c5d64208` / `25319ded`            | Signed-in t1a public board renders; one customer post; launch plan “You’re up and running”.                                                                                                                                                                                           |
| Support + HC live first-win         | live         | existing `sup9ca3a708` / `hc9ca3a708`                                             | **yes** hosts 200                          | Change goal + first-win reached. Support conversation + “You’re up and running”. HC article published + milestone 15 Aug 2026. Critic **PASS** `live-existing/critic.md`.                                                                                                             |
| Widget install Outlet               | app          | `40e1e6bf1`                                                                       | **yes** `532dbe27` / `27e0c23d`            | Install page is Connect Messenger + Enable Messenger (not parent Widget). Enable → Channel enabled + Add the SDK. Critic **PASS** `this-fire/install-critic.md`.                                                                                                                      |
| Self-host + internal first-win      | local app    | local `:3000` (cloud off)                                                         | skip-deploy (self-host only)               | General name only; no billing/switcher/URL. Launch plan Internal + “Collect your first team idea” reached. `self-host-walk-critic.md`.                                                                                                                                                |
| Self-host support + HC first-win    | local app    | local `:3000` (cloud off)                                                         | skip-deploy (self-host only)               | Support conversation + HC article milestones reached; useCase restored to internal. `self-host-outcomes-critic.md`.                                                                                                                                                                   |
| Change goal UI support + HC         | local app    | local `:3000` (cloud off)                                                         | skip-deploy (self-host only)               | Change goal picker after hydration; Connect Messenger / Open Help Center; restored Internal. `self-host-changegoal-critic.md`.                                                                                                                                                        |
| Outcome Ready + first-win copy      | app tests    | `587e96847`                                                                       | skip-deploy (tests-only)                   | Ready primaries + first-win titles for all four outcomes. `outcomes-critic.md`.                                                                                                                                                                                                       |
| Self-host General name              | app          | `8cb12d5f1`                                                                       | skip-deploy (self-host only)               | Local name card has no Quackback URL; billing nav and switcher stay absent when cloud is off. `self-host-critic.md`.                                                                                                                                                                  |
| PLG emit self-host skip             | app tests    | `3b4556ae2`                                                                       | skip-deploy (tests-only)                   | Cloud-off emits nothing; cloud-on logs bounded fields only. `plg-emit-critic.md`.                                                                                                                                                                                                     |

**Fleet note:** one deploy thread. Live pair is app `57068471` /
`sha256:910244e5…` (`fac1beed8`) and CP `108c480c` (`5359852`, sfo).
Docker `32009201320` SUCCESS. Channels/Email critic **PASS**.
Verify / §H still signed on the earlier `895b942d` / `b7ae7455` pair.

This fire (P4 Fleet + live critic, 2026-08-15 T18:32Z):

- Docker `31900766203` SUCCESS from `4bddea06f` as
  `ghcr.io/quackbackio/quackback@sha256:cf2a5726bbad7411bfb7409ddf497af27c156f93cf18bd1be37172d852189132`.
- JSON-patch `source.image` (service ids) + `redeploy --from-source`.
  Matching `meta.imageDigest`, web region only `us-east4-eqdc4a`:

  | role     | deployment | digest     | region            |
  | -------- | ---------- | ---------- | ----------------- |
  | web      | `fd136d22` | `cf2a5726` | `us-east4-eqdc4a` |
  | worker   | `59e32c58` | `cf2a5726` | `us-east4-eqdc4a` |
  | hourly   | `e4f6f888` | `cf2a5726` | `us-east4-eqdc4a` |
  | daily    | `b2b962d7` | `cf2a5726` | `us-east4-eqdc4a` |
  | migrator | `eac0ac73` | `cf2a5726` | `us-east4-eqdc4a` |

- Live critic **PASS** (`p4-overlay-critic.md`): t1a export **200**
  CSV; t7 **402** `features.analyticsExports`; Integrations Upgrade
  to Pro on Free; branding save returns TierLimitError copy, not 500. No Neon. No pay. Instances unchanged.
- Plan-restriction UX (P2–P4) closed.

This fire (P3 live critic, 2026-08-15 T18:01Z):

- Confirmed CP `9030705d` **SUCCESS**, `meta.imageDigest`
  `sha256:d84fd27c2d2d10ffba14a36b732540d462d396cd5f34a3102a962a9a40928741`,
  `cliMessage` “keep restore refusals on the dashboard”, region `sfo`.
- Live critic **PASS** (`p3-restore-critic.md`): unauth restore 303
  login (no JSON); owner restore at 3-Free 303
  `/dashboard?notice=free_workspace_owner_cap`; follow GET 200 HTML
  with `role=alert` and the 3-Free copy; trash stayed deleted.
  Temps only, no Neon. Instances 20→20.
- Did not start P4. Ledger-only commit (named skip-deploy).

This fire (P4 builder, 2026-08-15 T19:13Z):

- App `482f44938` `fix(settings): copy Pro feature flags from the
billing projection`. Overlay copies `analyticsExports` /
  `customColors` / `customCss` / `integrations` from
  `effectivePlan`. `wrapDbError` rethrows `DomainException` (branding
  402, not 500). Same `UpgradeOffer` on branding save and Integrations.
- Focused tests 33 passed (`tier-limits`, `wrap-db-error`,
  `branding-tier-gate`, `settings.integrations`,
  `platform-credentials-tier-gate`).
- Docker `31900508741` dispatched `--ref saas`. **FAILED**
  import-protection (`tier-limits.service` in Integrations loader).
  Fix `4bddea06f` uses `hasTierFeatureFn`. Redispatched
  `31900766203`. SUCCESS this fire.

This fire (Fleet + P2 critic, 2026-08-15 T17:49Z):

- Docker `31898534925` SUCCESS from `e56d00b9a` as
  `ghcr.io/quackbackio/quackback@sha256:27c538ec143d31f526e7aa8c0042f73c601db04e54c6eaa69240dd06844c2397`.
- `source.image` JSON-patch (service ids, not `--service-config`
  name) + `redeploy --from-source`. Matching `meta.imageDigest`,
  region only `us-east4-eqdc4a`:

  | role     | deployment | digest     | region            |
  | -------- | ---------- | ---------- | ----------------- |
  | web      | `7057e905` | `27c538ec` | `us-east4-eqdc4a` |
  | worker   | `796aba45` | `27c538ec` | `us-east4-eqdc4a` |
  | hourly   | `4b927894` | `27c538ec` | `us-east4-eqdc4a` |
  | daily    | `0de9564e` | `27c538ec` | `us-east4-eqdc4a` |
  | migrator | `f92d2783` | `27c538ec` | `us-east4-eqdc4a` |

- Ready 200 on gauntlet, t1a, t7s, t7h.
- Live critic **PASS** (`p2-upgrade-critic.md`): t1a Access &
  Security 200; t7 webhook/MCP Growth `$25` modal; workflows Pro
  `$49` modal; macros in-route Growth screen; Developers mixed page
  up; live JS `billingEnabled` gates catalogue/checkout.
- Did not pay, create Neon, or start custom domains. Instances
  unchanged. Concurrent CP `c208c06` / `9030705d` is P3 code — not
  live-critic'd this fire.

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
item+plan frees a slot; count is `ownerEmail`.

### Live deploy + 4th-Free (2026-08-14)

Fleet: app `635cdb149` still in `cb186135` / web `47e0c7be`. No app
redeploy. Stripe-live not repeated. No second CP-create builder.

`railway up` CP `saas` `2fb9488` → `80c8301e` SUCCESS
`sha256:3d10454a…`. Live `free-workspace-cap.ts` present. No owner
had 3 Free (max 1); two temporary live-Free rows (no Neon) made t1e’s
count 3; `_internal_createInstance` 402 `free_workspace_owner_cap`;
no insert/provision; temps deleted; instances 16→16.

### Critic (2026-08-14, live 3-Free cap)

PASS — CP `80c8301e` digest `3d10454a`; live reason string present;
instances 16; zero leftover cap-probe rows; t1a/t1e remain.
`loop-evidence/t3-pay/cp-cap-live-critic.md`. Did not create Neon.

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
PASS. **Live** as `sha256:cb186135…` (web `47e0c7be`).

## Limits overlay live (2026-08-14)

Fleet this fire: `635cdb149` already live; did not redeploy that
commit alone. Docker `31843458993` built `saas` `f0186af2b` as
`ghcr.io/quackbackio/quackback@sha256:cb18613577d7acc9e6882acd1bf52c7a88576f5d4f1be50adf84269f1d66a166`.
`source.image` + `serviceInstanceDeployV2` SUCCESS, matching digest,
`us-east4-eqdc4a` only:

| role     | deployment | digest     |
| -------- | ---------- | ---------- |
| web      | `47e0c7be` | `cb186135` |
| worker   | `4576ca28` | `cb186135` |
| hourly   | `bac96be0` | `cb186135` |
| daily    | `4b77de9d` | `cb186135` |
| migrator | `ced6922a` | `cb186135` |

Ready 200 on gauntlet, south, north. Live web bundle defines
`resolveEffectiveTierLimits` / `cloudProjectionFloor`. Stripe-live not
repeated. CP-create not redeployed. Custom domains not started.

### Critic (2026-08-14, limits image `cb186135`)

PASS — five roles SUCCESS on `sha256:cb186135…` in `us-east4-eqdc4a`;
three health URLs 200; replica exports `resolveEffectiveTierLimits`.
`loop-evidence/verify-2026-08-14/limits-deploy-critic.md`.

## This fire (2026-08-15, orchestrator)

Fleet: live web `e20c0eef` SUCCESS `sha256:895b942d…` (`cb3c65420`),
region only `us-east4-eqdc4a`. Worker `adc52e84`, hourly `e232e3f8`,
daily `7f893013`, migrator `141d5a5d` same digest. `635cdb149` is an
ancestor. **No deploy.** Ready 200 on gauntlet / t1a / t1e / t7.

Stripe-live: first t1a + t1e payments + t1e period-end Growth
schedule already finalized — **not repeated.**

CP-create: 3-Free already live `c5a484d` / `80c8301e`. **No second
builder.** No isolated worktree to merge.

Verify **PASS 0 HIGH** re-signed on `895b942d` / `b7ae7455`
(`sweep-e20c0eef.md` 11:13Z). t1a Pro **409**; t1e Scale **409**;
t7 Growth **303** `checkout.stripe.com`; foreign Origin **403**;
foreign session **401**; unauth delete/restore **303**. Instances
**19→19**. Named critic spawn unjoinable; orchestrator live-critic
**PASS** (`fleet-idle-critic.md`).

No Neon. No live key. Custom domains not started.

Previous fire (t1e period-end schedule):

Fleet: live web `e20c0eef` SUCCESS `sha256:895b942d…` (`cb3c65420`),
region only `us-east4-eqdc4a`. `635cdb149` is an ancestor. **No
635cdb149 deploy.** Ready 200 on gauntlet / t1a / t1e.

Stripe-live: first t1a + t1e payments already finalized — **not
repeated**. Mid-unit **t1e Scale → Growth scheduled at period end**:
gateway **200** `billing.stripe.com`; Stripe test schedule **active**
phases [scale] then [growth]; CP `plan_id` / effective still **scale**;
`pending_plan_id` null; t1a **pro**; instances **19→19**. Critic
**PASS** (`t1e-downgrade-critic.md`). Did not pay again.

Verify **PASS 0 HIGH** re-signed on `895b942d` / `b7ae7455`
(`sweep-e20c0eef.md`). t1a Pro **409**; t1e Scale **409**; t7 Growth
**303** `checkout.stripe.com`; foreign Origin **403**; foreign
session **401**; unauth delete/restore **303**. Instances **19→19**.

CP-create: 3-Free already live `80c8301e`. **No second builder.**

Previous fire (https Location):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.** CP `railway up` `8e4c00a` → `b7ae7455` SUCCESS
`sha256:45b9aebb…` (sfo).

Stripe-live: t1e Scale already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **https Location** on unauth delete/restore. Tests 8/8.
POST t1a delete/restore **303** `https://cp.quackback.co.uk/auth/login`
(was `http://`). Critic **PASS** (`lifecycle-https-critic.md`).

Previous fire (compact Verify):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.**

Stripe-live: t1e Scale already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Verify **PASS 0 HIGH** on `895b942d` / `aed43943`
(`sweep-e20c0eef.md`). t1a Pro **409**; t1e Scale **409**; t7 Growth
**303** `cs_test_`; foreign session **401**; unauth delete/restore
**303**. Instances **19→19**. No Neon. Custom domains not started.

Previous fire (SSO enforce):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.**

Stripe-live: t1e Scale already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **SSO enforce → fail-open** on t1e. Dummy
`auth_oidc_loopenforce` credential (no issuer). With cred: password
and magic-link **302** `verified_domain_requires_sso`. After delete
cred: magic-link **200**. Probe rows gone. Critic **PASS**
(`sso-enforce-critic.md`). Instances **19**. Custom domains not
started.

Previous fire (SSO fail-open only):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.**

Stripe-live: t1e Scale already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **SSO fail-open** on t1e. Enforced domain + IdP row
without a credential (not registered). Password **302**
`password_method_not_allowed`; magic-link **200**; neither is
`verified_domain_requires_sso`. Probe rows deleted. Critic **PASS**
(`sso-failopen-critic.md`). Instances **19**. No real issuer. Custom
domains not started.

Previous fire (§H Scale):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.**

Stripe-live: t1e Scale already paid last fire. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **§H Scale** on t1e. Overlay unlimited boards/posts/seats
(null, not OSS); sso/audit/workflows/webhooks true; `/sso/new`
create fields; same-plan **409**; portal **303**. Critic **PASS**
(`plan-matrix-scale-t1e.md`). Instances **19→19**. Did not add an
IdP. Custom domains not started.

Previous fire (t1e Scale pay):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.**

Stripe-live: t1e Growth → **Scale** monthly via gateway confirm
**200** `billing.stripe.com` + Stripe test `always_invoice`. Webhook
`customer.subscription.updated` + `invoice.paid` processed. Outbox
v6 `effectivePlan=scale` `sso=true`. t1a stays Pro. **Did not
repeat t1a first pay.**

CP-create: 3-Free already live. **No second builder.**

Live unit: Scale fixture + SSO create surface. t1e
`/sso/new` **200** with issuer/client fields (was locked). Fail-open
unit 3/3. Did **not** add an IdP. Critic **PASS**
(`t1e-scale-critic.md`). Instances **19→19**.

Verify / §H still signed on app `895b942d` (Growth fixture is now
Scale). Custom domains not started.

Previous fire (named delete/restore 303):

Fleet: `635cdb149` already in `e20c0eef` / `sha256:895b942d…`. **No
635 deploy.** CP `railway up` `ef31b2a` → `3a9bc4ee` SUCCESS
`sha256:aed43943…` (sfo). First `295b263` still 500'd because
delete/restore called the createServerFn wrapper.

Stripe-live: t1a Pro + t1e Growth still paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **named unauth delete/restore** (Bar B). Tests 6/6.
Unauth POST t1a/t1e delete+restore **303** `/auth/login` (was 500
`HTTPError`). Rows not deleted. Critic **PASS**
(`lifecycle-auth-critic.md`). Instances **19→19**.

SSO downgrade still needs a Scale host + IdP. Custom domains not
started. Verify / §H still on app `895b942d`.

Previous fire (CP outage):

Fleet: `635cdb149` already an ancestor of live `sha256:895b942d…`,
`us-east4-eqdc4a` only. **No 635cdb149 deploy.** Web-only env flip
for the outage unit (same image): `3f4a09b0` blackhole then
`e20c0eef` restore to `https://cp.quackback.co.uk`.

Stripe-live: t1a Pro + t1e Growth still paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **CP outage** from the workspace (web
`QUACKBACK_CONTROL_PLANE_URL` → invalid HTTPS origin; CP process
stayed up). t1a inbox **200** from last projection; Scale and
same-plan billing **503** with retry copy (not 500). After restore:
Scale **303** `billing.stripe.com`, same-plan **409**. Critic
**PASS** (`cp-outage-critic.md`). Instances **19→19**.

Verify / §H still signed on `895b942d` / `753d3b86` (same digest).
No Neon. No live key. Custom domains not started.

Previous fire (8a restore-at-cap):

Fleet: `635cdb149` already in live `932a38f9` / `sha256:895b942d…`,
`us-east4-eqdc4a` only (source.image + region pin). Five ready 200. **No deploy.**

Stripe-live: t1a Pro + t1e Growth still paid (item + active sub).
**Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Live unit: **8a restore-at-cap + switcher list** on existing t7s
(`inst_01m021rrs…`). t7s and t7h are different owners — not siblings.
Temps (no Neon, no `provisionedAt`) raised t7s live-Free 1→3;
`_internal_restoreInstance` **402** `free_workspace_owner_cap`; trash
stayed deleted; soft-delete of one temp → 2. Switcher GET 401 / 200
empty / 200 two untitled siblings with no `ws-*` URL; open extras
**400**; foreign + cross-owner **403** `not_owner`. Critic **PASS**
(`t8a-restore-critic.md`). Instances **19→19**. Leftover `inst_cap8a_*`
**0**.

Verify / §H still signed on `895b942d` / `753d3b86` (no image change).
No Neon. No live key. Custom domains not started. Did not take CP down.

Previous fire (Verify + named billing 401):

Previous fire (named billing 401/403 deploy):

Fleet: `635cdb149` already an ancestor. Customer-visible
`cb3c65420` (named billing refusals) Docker `31875492036` →
`sha256:895b942d…`. `source.image` + `redeploy --from-source`:

| role     | deployment | digest     | region            |
| -------- | ---------- | ---------- | ----------------- |
| web      | `932a38f9` | `895b942d` | `us-east4-eqdc4a` |
| worker   | `adc52e84` | `895b942d` | `us-east4-eqdc4a` |
| hourly   | `e232e3f8` | `895b942d` | `us-east4-eqdc4a` |
| daily    | `7f893013` | `895b942d` | `us-east4-eqdc4a` |
| migrator | `141d5a5d` | `895b942d` | `us-east4-eqdc4a` |

Ready 200. Tests 5/5. Live: no-cookie **401** `unauthorized`; t1a
cookie on t1e **401** `unauthorized` (was 500); t1e same-plan
**409**; Origin 403. Critic **PASS** (`billing-authz-critic.md`).

Stripe-live: t1a + t1e already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Instances **19→19**. No Neon. No live key. Custom domains not started.

Previous fire (projection probes):

Fleet: `635cdb149` already in live `95610fd8` / `sha256:40be439d…`,
`us-east4-eqdc4a`. Gauntlet ready 200. No deploy.

Stripe-live: t1a + t1e already paid. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Projection probes on existing t1e: replay **204**, stale **409**
`stale_version`, garbage **401**. Paid Growth survives the still-set
trial clock. Product 200 from cached projection. Focused tests 12/12
(exact expiry + monotonicity). Critic **PASS**
(`projection-probes-critic.md`). Instances **19→19**. Did not take
CP down. No Neon. No live key. Custom domains not started.

Previous fire (Free plan-matrix t7):

Fleet: `635cdb149` already in live `95610fd8` / `sha256:40be439d…`,
`us-east4-eqdc4a`. Gauntlet ready 200. No deploy.

Stripe-live: t1a + t1e payments already finalized. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Plan-matrix Free fixture on existing t7 `sup9ca3a708` /
`hc9ca3a708`: overlay 2/50/1, all paid grants false, Growth **303**
`cs_test_`, portal **403**. Critic **PASS**
(`plan-matrix-free-t7.md`). Instances **19→19**. No Neon. No live
key. Custom domains not started.

Previous fire (Verify after Growth pay):

Fleet: `635cdb149` already in live `95610fd8` / `sha256:40be439d…`,
`us-east4-eqdc4a`. No deploy. Workspace re-prove **PASS**: t1a Pro
**409**; t1e Growth **409**; t1e Scale **303** `billing.stripe.com`;
Origin 403. `fleet-reprove-growth.json`.

Stripe-live: t1a and t1e payments already finalized. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Verify **PASS 0 HIGH** on `40be439d` with t1e now Growth paid
(`sweep-40be439d-growth.md`). Overlay t1e boards 3 / posts 50 / seats
1; webhooks+mcp true; workflows false. t1a still Pro 10/10. §H
**PASS** (`plan-matrix-40be439d-growth.md`). Instances **19→19**.
No Neon. No live key. Custom domains not started.

Previous fire (t1e Growth payment):

Fleet: `635cdb149` already an ancestor of live `be3e41b01` /
`sha256:40be439d…` / web `95610fd8`, `us-east4-eqdc4a`. Five health 200. t1e Upgrade was **303** `cs_test_` before this pay. No
635cdb149 deploy.

Stripe-live: t1a first pay not repeated. **Second paid** on existing
t1e (`northfa99f0`, `inst_01m00kprbrfzzb19f490wga8q2`): Growth
monthly `cs_test_` Checkout paid (4242). Stripe `complete`/`paid`
`livemode=false` `kind=workspace_subscription` metadata t1e. Webhook
`checkout.session.completed` + `customer.subscription.created`
processed (`evt_1U4c…`). t1e `plan_id=growth`, item `si_V4mGq…`,
outbox v5 delivered. t1a remains Pro. After pay: t1e same-plan
Growth **409** `already_on_plan`; t1e portal + Scale **200**
`billing.stripe.com`; t1a same-plan Pro still **409**. Instances
**19→19**. Critic **PASS** `this-fire/t1e-pay-critic.md`.

CP-create: 3-Free already live. **No second builder.**

No Neon. No live key. Custom domains not started.

Previous fire (already_on_plan 409 deploy):

Fleet: `635cdb149` already an ancestor of live `74024a9cb`. Pickup
had undeployed customer-visible **already_on_plan** app `be3e41b01`
(Docker `31872616168` → `sha256:40be439d…`). CP `f4e3844` was already
live as `7cecf06d` (`sha256:753d3b86…`).

`source.image` + `railway redeploy --from-source`:

| role     | deployment | digest     | region            |
| -------- | ---------- | ---------- | ----------------- |
| web      | `95610fd8` | `40be439d` | `us-east4-eqdc4a` |
| worker   | `9cd49fe5` | `40be439d` | `us-east4-eqdc4a` |
| hourly   | `2634ef48` | `40be439d` | `us-east4-eqdc4a` |
| daily    | `057206ec` | `40be439d` | `us-east4-eqdc4a` |
| migrator | `def8cdde` | `40be439d` | `us-east4-eqdc4a` |

Ready 200 on gauntlet, south, north, support, HC. Workspace owner
POST t1a same-plan Pro monthly **409** `already_on_plan` (not 503).
t1a Scale **303** `billing.stripe.com`. t1e Upgrade **303**
`cs_test_`. Foreign/missing Origin **403** `invalid_origin`.
Instances **19→19**. Evidence `this-fire/ws-already-on-plan.json`.
Named critic spawn unjoinable; orchestrator
live-critic **PASS** (`already-on-plan-critic.md`).

Stripe-live: t1a first payment + Growth→Pro + cancel already
finalized. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Verify **PASS 0 HIGH** on `40be439d` / `7cecf06d`
(`sweep-40be439d.md`). Same-plan Pro is now **409** (was 503 on
`2575b236`). Domains card 200 both hosts; no hostname add. §H **PASS**
(`plan-matrix-40be439d.md`) with t1a Pro paid. Instances **19→19**.
No Neon. No live key. Custom domains not started.

Previous fire (Verify on Domains-card image):

Fleet: `635cdb149` already in live `74024a9cb` / `sha256:2575b236…` /
web `59da45c2`, `us-east4-eqdc4a`. Health 200. t1e Upgrade **303**
`cs_test_`; Origin 403. No 635cdb149 deploy.

Stripe-live: t1a first payment + Growth→Pro + cancel already
finalized. **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Verify **PASS 0 HIGH** on `2575b236` / `69cb0353`
(`sweep-2575b236.md`). Domains card 200 both hosts; no hostname add.
§H **PASS** (`plan-matrix-2575b236.md`) with t1a Pro paid. Instances
**19→19**. No Neon. No live key. Custom domains not started.

Previous fire (Verify on install-Outlet image):

Fleet: `635cdb149` already in live `40e1e6bf1` / `sha256:27e0c23d…` /
web `532dbe27`, `us-east4-eqdc4a`. Five health 200. t1e Upgrade **303**
`cs_test_` (foreign/missing Origin 403). No 635cdb149 deploy.

Stripe-live: t1a Growth paid (sub active, item, outbox v4). **Not
repeated.**

CP-create: 3-Free already live. **No second builder.**

Verify **PASS 0 HIGH** on `27e0c23d` / `1931dc38`
(`sweep-27e0c23d.md`). Plan-matrix §H **PASS**
(`plan-matrix-27e0c23d.md`). Instances **19→19**. No Neon. No live
key. Custom domains not started.

Previous fire (install Outlet + Track 7 first-win):

Fleet: `635cdb149` already in live `52c1ab397` / `sha256:25319ded…` /
web `c5d64208`, `us-east4-eqdc4a`. Five health 200. t1e Upgrade **303**
`cs_test_` (foreign/missing Origin 403). Fleet critic
`this-fire/fleet-critic.md` **PASS**. No 635cdb149 deploy.

Stripe-live: t1a Growth paid (sub active, item, outbox v4, checkout
completed processed). **Not repeated.**

CP-create: 3-Free already live. **No second builder.**

Instances **19→19**. Two t7 hosts already existed (`sup9ca3a708`,
`hc9ca3a708`); this fire created no Neon.

Track 7 on those hosts: Change goal (after hydration) to Customer
support / Help Center. Support: Conversations toggle + visitor
`Ask a question` → first conversation; launch **You’re up and
running** + milestone. HC: article published; launch **You’re up
and running** + **Publish your first article** (15 Aug 2026). Shots
`loop-evidence/t7-first-win/live-existing/`. Named critic spawned.

HIGH: `/admin/settings/widget/install` rendered the parent Widget
page (no Outlet). Fixer `40e1e6bf1` tests 33/33. Docker
`31870327511` → `sha256:27e0c23d…`. `source.image` +
`railway redeploy --from-source`: web `532dbe27`, worker `c4854a60`,
hourly `51b82597`, daily `810ae26b`, migrator `3d64955e`. All
`us-east4-eqdc4a`. Digest matches. Ready 200. Live install page
Enable Messenger → Channel enabled. Critic **PASS**. No live key.
Custom domains not started.

Previous fire (Change goal UI):

Previous fire (Change goal UI):

Fleet: `635cdb149` already in live `52c1ab397` / `sha256:25319ded…` /
web `c5d64208`, `us-east4-eqdc4a`. Health 200. No deploy. Stripe-live
not repeated. CP-create already live; no second builder. No Neon.
No live key. Custom domains not started. Instances **17**.

Track 7: Change goal UI on local `:3000` after hydration. Support +
Help Center first-win via **Change goal → Use this goal**, then
restored Internal. Prior picker miss was a too-early click /
`sr-only` radio, not a product bug. Critic **PASS**
(`self-host-changegoal-critic.md`). Skip-deploy. Verify / §H still
signed on `25319ded`.

Previous fire (SQL useCase flip for support/HC):

Fleet: `635cdb149` already in live `52c1ab397` / `sha256:25319ded…` /
web `c5d64208`, `us-east4-eqdc4a`. Health 200. No deploy. Stripe-live
not repeated. CP-create already live; no second builder. No Neon.
No live key. Custom domains not started. Instances **17**.

Track 7 local support + Help Center first-win: flipped
`setup_state.useCase` on the existing self-host fixture (Change goal
UI click did not open the picker), then restored `internal`.

- Support: “Receive your first customer conversation” reached;
  Ready **Connect Messenger**.
- Help Center: “Publish your first article” reached 21 Jul 2026.
- Critic **PASS** (`self-host-outcomes-critic.md`). Skip-deploy.
- Verify / §H still signed on `25319ded` (no image change).

Previous fire (local self-host + internal first-win):

Fleet: `635cdb149` already in live `52c1ab397` / `sha256:25319ded…` /
web `c5d64208`, region only `us-east4-eqdc4a`. Five health URLs 200.
No deploy. Stripe-live first t1a payment already finalized — **not
repeated**. CP-create 3-Free already live `80c8301e` — **no second
builder**. No Neon. No live key. Custom domains not started.
Instances **17→17**.

Track 7: support / HC live walks still need new workspaces (Neon
forbidden unless 3-Free needs it). Local self-host is allowed.

- Built missing `packages/widget/dist/browser.js` (gitignored) so Vite
  can load. Restored the existing local `SECRET_KEY` (JWKS decrypt).
  `bun run dev` on `:3000`, ready 200 `role=all`, `settings.cloud` null.
- Builder walk: demo password sign-in; General is Workspace Name only
  (`Acme Corp`); no Plan & billing / Switch workspace / Quackback URL /
  trial / Upgrade. Launch plan **Internal feedback**, “You’re up and
  running”, first-win **Collect your first team idea** reached
  13 Jul 2026. Shots: `loop-evidence/t7-first-win/self-host-walk/`.
- Critic **PASS** (`self-host-walk-critic.md`). Named skip-deploy
  (self-host surface; live cloud pair unchanged).
- Verify / §H remain signed on `25319ded` / `1931dc38` (no image
  change).

Previous fire (PLG emit skip) is historical.

Track 7 PLG: `3b4556ae2` proves `emitPlgEvent` is a no-op when cloud
is off and logs only the bounded vocabulary when cloud is on. Tests
9/9. Named skip-deploy. Critic
`loop-evidence/t7-first-win/plg-emit-critic.md`. Support / HC /
internal live walks still need Neon.

Previous fire (self-host General Bar C) is historical.

Track 7 / Bar C: `8cb12d5f1` extracts the self-host General name card
and proves it has no cloud URL. Cloud URL field does not prefill
`ws-*`. Tests 12/12 (identity + billing nav + switcher absent). Named
skip-deploy (self-host surface, live cloud unchanged). Critic
`loop-evidence/t7-first-win/self-host-critic.md`. Support / HC /
internal live walks still need Neon.

Previous fire (per-outcome Ready tests) is historical.

Track 7 tests `587e96847`: Ready primary + first-win title for all four
outcomes. Tests 32/32. Named skip-deploy (tests-only). Critic
`loop-evidence/t7-first-win/outcomes-critic.md`. Live five-outcome
walks still need Neon or a local self-host host.

Previous fire (Verify + §H on `25319ded`) is historical.

Verify **PASS 0 HIGH** on `25319ded` / `1931dc38`
(`sweep-25319ded.md`). Instances **17→17**. Plan-matrix §H **PASS**
(`plan-matrix-25319ded.md`). Overlay still not unlimited. t1a first-win
post still public. Support / HC / internal / self-host walks remain.

Previous fire (product-feedback first-win) is historical.

Track 7 product-feedback first-win was blocked: leftover t1a board
`access` is `{ view: anonymous, submit: authenticated }` with no
`moderation`. Signed-in public board crashed
`board.access.moderation.signedPosts` (Railway logs + React #419
skeleton). `52c1ab397` defaults missing vote/comment/segments/moderation
to the public-preset inherit shape. Tests 200/200 (boards schema +
policy). Docker `31860058211` → `sha256:25319ded…`. `source.image` +
`railway redeploy --from-source`: web `c5d64208`, worker `086ed99a`,
hourly `b48414aa`, daily `518eae03`, migrator `e7d2d36a`. All
`us-east4-eqdc4a`. Digest matches. Ready 200 on five health URLs.

Live: portal sign-in on t1a; after the image, signed-in board hydrates
and accepts Submit. One customer post + auto-vote. Owner getting-started
“You’re up and running”. Shots: `loop-evidence/t7-first-win/`. Critic
**PASS** (`loop-evidence/t7-first-win/critic.md`). Support / Help Center
/ internal / self-host walks remain (would need Neon or a local
self-host host). Verify / §H on this pair are this fire.

Previous fire (launch-plan card critic) is historical.

Previous fire (Track 6 scan) is historical.

Track-6 boundary scan **PASS**. No live `BILLING_API_KEY` /
`BILLING_PRICES` / `BILLING_WEBHOOK_SECRET` on web/worker/crons/
migrator. No imports of deleted `domain-multi-fn` / `org-billing-fn` /
`members-fn`. `loop-evidence/track6-scan/critic.md`. No deploy. Custom
domains not started. First-win still open.

Previous fire (§H PASS) is historical.

Plan-matrix §H **PASS** against `71f78ecb` / `1931dc38`
(`plan-matrix-71f78ecb.md`). Catalogue stickers honest; Growth
webhooks/mcp both layers true; usage `N of M`; SSO `/new` locked
(“not included”); HC local writer absent. Instances **17→17**. No
Neon. No live key. Custom domains not started.

Previous fire (Growth dual-layer + Verify PASS) is historical.

Fuller Verify **PASS 0 HIGH** on `71f78ecb` / `640d5ac1`
(`loop-evidence/verify-2026-08-15/sweep.md`). Instances 17→17.

Growth dual-layer: CP `64ca931` tests 7/7. `railway up` from
`/home/james/quackback-cp` → `1931dc38` SUCCESS `sha256:79030f27…`.
Live replica Growth features.webhooks/mcp **true** and match
`PLAN_GRANTS`. Free still false. Critic PASS
`loop-evidence/growth-grants/critic.md`. §H not re-signed this fire.

Previous fire (catalogue stickers) is historical.

Catalogue stickers: CP `dc86c83` tests 3/3. `railway up` from
`/home/james/quackback-cp` → `3006af01` SUCCESS `sha256:8edadea8…`.
Live `GET /catalogue` 200: Free/Growth `2/3 boards · 50 posts`, no
unlimited posts, no Growth integrations/webhooks, no Pro `1M API`.
Instances **17→17**. Critic PASS
`loop-evidence/catalogue-stickers/critic.md`.

Previous fire (8f export/wipe) is historical.

8f: General danger card (workspace-local export + owner wipe) and CP
account delete. Tests CP 21/21, app 15/15. First `railway up` from the
wrong cwd FAILED (`f12c4ffa`). Retry from `/home/james/quackback-cp`
`940c984` → `9aaa6ff2` SUCCESS `sha256:640d5ac1…`. Docker
`31855839488` `--ref saas` `e22e3884e` → `sha256:71f78ecb…`.
`source.image` + `railway redeploy --from-source`: web `371883f5`,
worker `b56b36fa`, hourly `597ee448`, daily `9bac011c`, migrator
`af9e6263`. All `us-east4-eqdc4a`. Digest matches. Ready 200 on five
health URLs. Live critic PASS. Instances **17→17**. Did not POST a
real wipe. No Neon. No live key. Custom domains not started.

### Critic (2026-08-15, 8f export/wipe `940c984` / `e22e3884e`)

PASS — General serves export + wipe copy; wipe 401 without credential
and 400 on extras/`confirm:yes`; account delete 401 then 403
`account_has_live_workspaces` on a live t1a-owner session; instances
17; digest `71f78ecb` in `us-east4-eqdc4a`. `loop-evidence/t8f/`.
Did not POST a real wipe. Did not write `deletedAt` on t1a/t1e.

Previous fire (8e usage) is historical.

8e: Plan & billing Usage card (`fetchPlanUsageFn`, finite keys only) +
CP list `N of 3 Free workspaces`. Tests app 5/5, CP 8/8. Docker
`31854913346` → `sha256:0651b0c6…`. Web `57d9793c` `us-east4-eqdc4a`.
CP `railway up` `143184d` → `9b70f160`. Live critic PASS. Instances
**17→17**.

Previous fire (8d SSO/seat lock) is historical.

8d: SSO `/new` was fail-open because root context has no `tierLimits`
(`!== false` treated missing as allowed). `6fadc0205` loads
`hasSsoEntitlementFn` and locks create + invite at cap. First Docker
`31853958063` failed import-protection; `46c1c602e` + Docker
`31854108659` → `sha256:bc35ed23…`. Web `5dcaf3bf` `us-east4-eqdc4a`.
Live critic PASS: t1a/t1e `/sso/new` no create fields; Members `1 of 1
seats` + disabled Invite. Tests 15/15. Instances **17→17**.

Previous fire (HC writer fixer + §H FAIL) is historical.

Fuller Verify on `52e78237` **FAIL 1 HIGH**: cloud Help Center still
used the local reverse-proxy domain writer. Fixer `ce57a0bcc` (tests
29/29). Docker `31852922694` → `sha256:47e64d52…`. Deploy web
`b14470ee` + four roles, `us-east4-eqdc4a`. Live critic PASS: t1a
Help Center Domains 200, no TLS-terminates card. Instances **17→17**.
Did not start Cloudflare for SaaS.

Plan-matrix §H **FAIL** (signed against `52e78237`):
`loop-evidence/plan-matrix-52e78237.md`. Remaining HIGH: catalogue vs
enforcement stickers; Growth webhooks/mcp grant vs feature; missing
`N of M` (8e); SSO `/new` reachable on Growth/trial. Do not pick a
sticker-vs-code winner this fire.

Previous fire (8c merge+deploy) is historical.

- Tests: CP 14/14 (`ownership.test.ts`); app 18/18 (ownership UI +
  client).
- First `railway up` from the wrong cwd FAILED (`d8abf7d7`, no
  Dockerfile). Prior CP `0e8d89a4` stayed live. Retry from
  `/home/james/quackback-cp` → `6f0b0fee` SUCCESS `sha256:25b24e49…`.
- Docker `31851333571` `--ref saas` `ef9fe62b9` →
  `sha256:52e78237…`. `source.image` + region pin +
  `serviceInstanceDeployV2`: web `93838859`, worker `f9e5a879`,
  hourly `d528fef4`, daily `ee9f3cfc`, migrator `98d0ed1d`. All
  `us-east4-eqdc4a`. Digest matches. Ready 200 on five health URLs.
- Live critic PASS: ownership/leave fail-closed; instances **17→17**.
  `loop-evidence/t8c/`. Compact Verify on this digest: 0 HIGH
  (`sweep-52e78237.md`). §H not started (same-hosts critic; next
  fire). No Neon. No live key. Custom domains not started.

Previous fire (Fleet 303 re-prove + isolated 8c) is historical.

### Critic (2026-08-14, 8c transfer/leave `209c8fb` / `ef9fe62b9`)

PASS — independent live POST/GET on the instance-scoped ownership
gateway; owner cannot leave; stranger transfer 403; extras 400;
instances 17; digest `52e78237` in `us-east4-eqdc4a`.

HTTP: `loop-evidence/t8c/critic.md`, `probe-http.json`. No bearer /
dummy → 401 `unauthorized`. t1a/t1e GET ownership 200. Transfer
stranger 403 `not_teammate`. Owner leave 403 `owner_cannot_leave`.
Did not write `ownerEmail`. Did not create Neon.

Previous fire (paid plan switch):

Fleet: `635cdb149` already live in the prior image and in this one.
Pickup had undeployed **paid plan switch** (customer-visible):

- CP `railway up` `b7948ee` → `0e8d89a4` SUCCESS.
- Docker `31849377285` `--ref saas` `717560270` → `sha256:1bf7ba8c…`.
  `source.image` + region pin + `serviceInstanceDeployV2`: web
  `52c6afaa` `us-east4-eqdc4a`.
- Live: t1a Change-to-Pro form **303** `billing.stripe.com`
  `/p/session/test_`; foreign Origin 403. CP no-auth 401; t1a checkout
  pro → portal (not Checkout); t1e growth → `cs_test_`. Instances
  **17→17**. No payment completed this fire. Stripe-live first-pay
  already on t1a. CP-create already live; no second builder. No Neon.
  No live key. Custom domains not started.

Previous fire (8b/Ready/catalogue `02cb4329`) is historical.

## Previous fire (2026-08-14, 8b deploy)

Fleet: `635cdb149` already in the prior image. Same-fire deploy of
undeployed customer-visible tips:

- CP `railway up` `4da4607` → `e0af5dc1` SUCCESS. Live 8b: list 401 /
  dummy 401 / t1a+t1e 200 empty; open 401 / extras 400 / t1a→t1e 403
  `not_owner`. Catalogue GET 200.
- Docker `31848148683` `--ref saas` `aebf31496` →
  `sha256:02cb4329…`. `source.image` + `serviceInstanceDeployV2` then
  re-pin `us-east4-eqdc4a` (first land `sfo`): web `d7fbdd0c`, worker
  `e51b4f23`, hourly `4787ab03`, daily `4fc8c630`, migrator `e6a4728d`.
  Digest matches. Ready 200 on five health URLs. Replica has
  `Switch workspace`, `owner-workspaces`, `Friendly Quackback URL`,
  0× `Skip for now`. t1e Upgrade 303 `cs_test_`; foreign/missing Origin 403. Stripe-live not repeated. CP-create already live; no second
  builder. Custom domains not started. This fire created no Neon.

Instance count is **17** (was 16). New row
`inst_01m017h6fwfes926nk0mff9svr` (`ws-1d1c2d4d48fc6615b770e189`,
provisioning, gmail.com) appeared at 22:50Z during the CP deploy; not
created by this Fleet lane. Left standing. t1a/t1e remain.

Previous fire (Ready/8b commit, vitest-only) is historical.

### Critic (this fire, live pair `02cb4329` / `e0af5dc1`)

Orchestrator live probe (critic spawn may be unjoinable): digest +
`us-east4-eqdc4a`; five health 200; CP 8b fail-closed + empty sibling
lists; replica has switcher + required URL, no Skip; t1e Upgrade 303.
Named critic spawned on the same URLs.

## Next commits

0. ~~**P2 Fleet + live critic**~~ `e56d00b9a` / `7057e905` /
   `sha256:27c538ec…`. Critic **PASS**.
   0b. ~~**P3 live critic**~~ CP `c208c06` / `9030705d` /
   `sha256:d84fd27c…`. Restore at 3-Free **303** dashboard notice.
   Critic **PASS** `p3-restore-critic.md`.
   0c. ~~**P4 app saas**~~ `4bddea06f` / `fd136d22` /
   `sha256:cf2a5726…`. Critic **PASS**.
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
12. ~~**Per-owner cap.**~~ live `80c8301e` / `2fb9488`. 4th Free 402
    `free_workspace_owner_cap` on t1e owner (temps, no Neon);
    instances 16.
13. ~~Hosted-product sweep HIGH (unlimited limits).~~ fixer live;
    re-sweep row 15 PASS (`limits-resweep.md`). Other Verify rows
    remain standing (Track 8, Domains card, first-win).
14. ~~Deploy `31330d85b` (Fleet).~~ live `f0186af2b` / `sha256:cb186135…`.
15. **Track 8 — hosted account operations.** ~~8a~~ live `0b85cd0`.
    ~~8b deploy~~ live CP `e0af5dc1` / app `02cb4329`.
    ~~8c transfer/leave~~ live CP `6f0b0fee` / `209c8fb`; app
    `93838859` / `ef9fe62b9` (`sha256:52e78237…`, `us-east4-eqdc4a`).
    ~~8d seats + SSO lock~~ live `46c1c602e`. ~~8e usage~~ live
    `3de751c01` / `143184d`. ~~8f export/wipe~~ live `e22e3884e` /
    `940c984`. Track 8 units closed.
    15b. ~~Ready CTA~~ `1a39cd7d7` in `02cb4329`.
16. ~~Cloudflare for SaaS custom-host serve~~ live-proved 2026-08-17.
    Originless fallback `saas-fallback.quackback.co.uk` + zone
    catch-all Worker. Customer CNAME target
    `customers.quackback.co.uk`. Identity gateway + Settings Domains
    card already live. E2E: add / cert / GET Track1 Alpha / restore
    (`custom-domain-e2e.md`). Do not print the token.
17. Plan & billing page: catalogue + invoices from the control plane
    (`GET /api/v1/internal/billing/catalogue` and `/invoices`). Cards
    use public pricing stickers (annual = 10 months). Workspace holds
    no price list. Cards live in `02cb4329`. **Change to {plan}**
    must open a Stripe confirm session for that price (this unit).
    Upgrades now (pro-rata); downgrades at period end.
18. First-win journeys. Product-feedback first-win is live on t1a
    (`52c1ab397`). All four outcomes + self-host Bar C proved on
    local `:3000` (skip-deploy). **Live Neon authorized 2026-08-15:**
    Support `sup9ca3a708` (`inst_01m021rrsd…`, Neon
    `qb-cp-ffe2b4983034867ff50fdf54`) and Help Center `hc9ca3a708`
    (`inst_01m021xvy6…`, Neon `qb-cp-8c38697ef940ff0d53bd1d68`).
    Instances 19. Ready 200. Change goal + first-win reached.
    Install Outlet live `27e0c23d`.
19. **Deploy paid plan switch** (this unit) on CP + app, then live-
    critic Change to X on t1a (Growth paid). Portal config is created
    on first session if seed has not run.
20. ~~**Plan-matrix critic**~~ signed **PASS** on `2575b236` / `d22ba5cf`
    (`plan-matrix-2575b236.md`). Prior PASS on `27e0c23d` is historical.
    Re-signed **PASS** on `40be439d` / `753d3b86`
    (`plan-matrix-40be439d.md`).
21. ~~**Same-plan 409**~~ live `be3e41b01` / `95610fd8` + CP `f4e3844` /
    `7cecf06d`. t1a same-plan **409** `already_on_plan`.
22. ~~**Second paid isolation**~~ t1e Growth paid + webhook finalize.
    t1a remains Pro. Same-plan 409 on both.
23. ~~**8a restore at 3 live Free**~~ live on `7cecf06d` / `895b942d`
    (`t8a-restore-critic.md`). Soft-delete does not count.
24. ~~**Control-plane outage**~~ live on `895b942d` / `e20c0eef`
    (`cp-outage-critic.md`). Inbox 200; billing 503 retry copy;
    recovered 303/409. CP process was not stopped.
25. ~~**SSO downgrade lets admins in**~~ live on t1e
    (`sso-enforce-critic.md`). Enforce 302 `verified_domain_requires_sso`;
    removing the credential (IdP not viable) restores magic-link **200**.
    No public issuer; no plan change. Do not start custom domains.
26. ~~**Unauth delete/restore 500**~~ live CP `ef31b2a` / `3a9bc4ee`.
    303 `/auth/login`. `lifecycle-auth-critic.md`.
27. ~~**https Location**~~ live CP `8e4c00a` / `b7ae7455`.
    `lifecycle-https-critic.md`.
28. ~~**t1e period-end Growth schedule**~~ live Stripe test schedule
    [scale] then [growth]; CP still Scale. `t1e-downgrade-critic.md`.
    Projection follow-through waits for the Stripe period clock.
29. ~~**First-customer DoD**~~ customer outcomes met on
    `895b942d` / `b7ae7455`. See Handover. Parked: custom-domain
    add/cert (provider); t1e period-end Growth projection (clock);
    leftover `cp_instances` columns. Do not start custom domains.
    Do not mint a live key. Do not create Neon.

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
  `6836a6a`, dropped in `449bd98` / SQL `0069`. New identity uses
  `cp_workspace_hostname_claims` + `cp_workspace_custom_domains`.
- ~~`r2_bucket_name`, `r2_token_id`~~ dropped in `449bd98` / `0069`.
  No named SELECT remained. `oidc_client_id` stays: admin/MCP still
  display the always-null column.
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
- ~~Railway web/worker/cron/migrator `BILLING_API_KEY` /
  `BILLING_PRICES` / `BILLING_WEBHOOK_SECRET`~~ removed (skip-deploys).
  Confirmed absent on all five app roles 2026-08-15.
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
Sweep 2026-08-14: `loop-evidence/verify-2026-08-14/sweep.md` FAIL one
HIGH (cloud unlimited overlay). Re-sweep
`loop-evidence/verify-2026-08-14/limits-resweep.md` **PASS** — t1a
`maxBoards=3`, t1e `maxBoards=10`, no stored row, not unlimited.
Compact re-sweep after 8c: `sweep-52e78237.md` **PASS** (0 HIGH) on
`52e78237` / `6f0b0fee`.

- **Plan-matrix critic** (`LOOP-VERIFY.md` §H): signed **PASS** on
  `25319ded` / `79030f27` (`plan-matrix-25319ded.md`). t1a = Growth
  paid, t1e = Pro trial.
  Catalogue / website vs CP `definitions.ts` / `PLAN_GRANTS` drift
  is in-scope HIGH. Do not treat the row-15 limits re-sweep as §H.
- Least-restrictive numeric limit overlay and exact-expiry: unit
  **12/12**; live t1e paid Growth is not dropped by a future
  `trialExpiresAt`. Free fallback at the exact instant is unit-proved.
  Live: Free cap refuses with a named plan; paid overlay lifts it;
  downgrade leaves existing over-cap resources removable.
- Plan change / downgrade / cancel / update-card through workspace
  Plan & billing (checkout + portal). Upgrade 303 and paid finalize
  are live on t1a **and** t1e. t1e Scale→Growth is a live Stripe
  **schedule** at period end (CP still Scale). Cancel-then-clear is
  live on t1a. Catalogue cards + invoices are live in `02cb4329`.
  Period-end projection follow-through still waits on the clock.
- ~~Cross-workspace checkout session metadata.~~ t1e session names t1e;
  extras `instanceId` cannot retarget. Second paid isolation live on
  t1e (`this-fire/t1e-pay-verify.json`).
- ~~Control-plane webhook replay and outbox retry.~~ webhook no/bad
  sig 400 on live; billing projection replay **204** / stale **409**
  (`projection-probes.json`). Outbox already delivered v5/v6.
- ~~Created/configured-only trial activation and immutable anchor.~~ live on both `ws-*` hosts.
- ~~Control-plane outage behavior for normal use and billing actions.~~
  live `cp-outage-critic.md`: inbox 200 from last projection; billing
  **503** retry copy; recovered 303/409. Helper `57ff32499` still
  skips when a trial already exists.
- Fresh-browser journeys for every onboarding outcome and self-hosted mode.
  All four outcomes + self-host Bar C proved on local `:3000`.
  Support / Help Center still need live workspaces. Ready primaries
  are tested (`587e96847`).
- Zero-input first-workspace creation and retry after interrupted provisioning.
- Live rename handoff, old-host redirect, and session survival on a new
  generated host. Local replay/expiry/wrong-host and pinned asset-origin
  tests passed (`1add15b16`, `4a1e97b`).
- Cloud settings contract: General (name/URL), Plan & billing, Domains
  (surface + CP gateway; live provider skipped), Emails without platform
  keys. A cloud workspace must not use the Help Center local domain
  writer as the cloud manager.
- Track 8: ~~restore vs 3-Free~~ live 8a on `7cecf06d` (temps, no Neon;
  `t8a-restore-critic.md`). Switcher list + fail-closed open live;
  no stranger same-owner sibling pair so Open-to-sibling handoff was
  not minted. ~~transfer/leave~~ live 8c; ~~seats + SSO lock~~ live
  8d; ~~visible usage~~ live 8e; ~~export/wipe/account delete~~ live 8f.
- Custom-domain ownership, DNS, hostname/SSL readiness, make-primary, removal,
  provider retry, and cross-workspace isolation. Provider client and
  fallback origin are ready (`de0b038`). Workspace Domains card and
  identity-gateway wiring are the next builder. Token is on CP only.

## Blockers

None that block the first-customer definition of done.

Parked / clock-wait (not a next loop phase):

- t1e Scale→Growth **schedule** is live; projection follow-through
  waits on the Stripe period clock (no test clock on that sub).
- Custom-domain add / DNS / certificate proof stays skipped
  (provider) until the operator asks. Domains card + gateway are live.
- Leftover `cp_instances.name`, `login_url`, `oidc_client_id`, and
  billing-sweeper columns still have writers. Walk3 webhook stays
  disabled.
- Switcher Open-to-sibling was not minted on a stranger pair. List
  - fail-closed open are live. The only same-owner pair is mixed
    `ws-*` + `e2e-t2` (not identity-capable).

## Handover (first-customer DoD, 2026-08-15)

Live pair: app `f04b339a` / `sha256:f9c64853…` (`d39f4243d`) and CP
`4a5ea8d7` / `sha256:43e28d87…` (`4ad81fc`). Operator follow-up after
DoD: CP workspace tiles show the official Quackback host (t1a
`south63792f.quackback.co.uk`) and omit generated `ws-*`. Ready custom
hosts would list under that official line; none are attached yet.
Verify **0 HIGH** and plan-matrix **PASS** were last signed on the
earlier `895b942d` / `b7ae7455` pair.

A stranger can: zero-input create → Open → name + required URL →
outcome starter → Pro trial → test checkout / plan change / portal
(downgrade schedule, cancel, card) / webhook finalize → named limit
refusals with a paid overlay → 3 live Free (4th 402) → switcher /
transfer / leave / usage / export-wipe. Self-host shows none of the
cloud commercial surface. Custom domains stay disabled.

Stop the 10-minute loop. Do not invent a next phase. Operator may
later ask for live hostname/cert proof or watch the t1e period-end
webhook.

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
