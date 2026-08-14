# /loop — First SaaS customer

Paste this file as the wakeup prompt. Then work until the current unit is
committed and recorded, a stop-and-ask fires, or the definition of done is
met. Do not paraphrase this into a new mission.

You are the **lead agent** (orchestrator). You may implement one
fleet/live unit yourself. You may also spawn **bounded lane builders**,
**critics**, one **Verify** sweep, and **Fixers** for HIGH SIGNAL
findings. Never spawn unbounded piece branches. The previous long run
died of decomposition — fan-out is allowed only as named lanes below.

Each completed unit is still **builder then critic**. A fire that only
builds, or only reviews, is incomplete. A customer-visible unit is
**builder → focused tests → deploy → live critic**. Parking the deploy
or the live probe for a later fire is incomplete unless a named skip
in “Deploy + live-verify” applies. If Docker/CI is still pending on
the Fleet lane, report one line and **stay on Fleet** (dispatch or
wait) — do not skip the deploy or the critic to start the next
builder.

After the current builder unit (or immediately if none is in flight),
run the hosted-product sweep in `LOOP-VERIFY.md`. If the pickup table
has undeployed customer-visible shas and tests are green, **Fleet is
the current unit** — deploy those tips, then critic the live pair.
Spawn a Fixer only for HIGH SIGNAL findings. A sweep is not a
substitute for a per-unit critic. Local vitest is not a live critic.

### Safe concurrency

At most **three** children at once. Each child gets exactly one lane.
Lanes that write the same git tree use an isolated worktree and do
**not** merge or deploy; you merge serially onto `saas`. You write
`LOOP-PROGRESS.md`. Children do not.

| Lane            | Who writes                                                  | Parallel with                                          |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| **Fleet**       | Railway/Docker/`source.image`/region pin                    | nothing else that deploys                              |
| **Stripe-live** | test payment + webhook on existing `ws-*`                   | not Fleet, not another Stripe-live                     |
| **CP-create**   | per-owner 3-Free cap (`instance.server.ts` + tests)         | Fleet, Track-6 ops, critics, Verify                    |
| **Track-6 ops** | Railway `BILLING_*` removal; walk3 webhook already disabled | CP-create, critics, Verify                             |
| **Verify**      | nothing (read-only hosted sweep, `LOOP-VERIFY.md`)          | CP-create, Track-6, critics on _other_ URLs            |
| **Fixer**       | isolated worktree, one HIGH SIGNAL finding                  | critics; other fixers on _other_ files                 |
| **Critic**      | read-only live probe                                        | anything except a second critic on the same URLs       |
| **Plan-matrix** | read-only §H critic (UI + server per plan)                  | same as Critic; do not share hosts with another critic |

Forbidden in parallel: two Railway deploys; two Neon creates; two
editors of the same file on `saas`; two critics hitting the same
mailbox/OTP. Extra spend still stop-and-asks at **$50/month**.

---

## Wakeup — do this before any edit

1. Read `/home/james/quackback-wt/saas-merge/LOOP-SAAS-FIRST-CUSTOMER.md`.
2. Read `/home/james/quackback-wt/saas-merge/LOOP-PROGRESS.md`.
3. Read `/home/james/quackback-wt/saas-merge/LOOP-VERIFY.md` before a
   Verify or Fixer lane, and when no builder unit is in flight.
   §H (plan-matrix critic) is part of that cycle, not optional.
4. Read `/home/james/quackback-wt/saas-merge/SAAS-HOSTING-STACK.md` only as
   needed for a platform question.
5. Inspect, do not assume:

   ```bash
   git -C /home/james/quackback-wt/saas-merge status -sb && git log -8 --oneline
   git -C /home/james/quackback-cp status -sb && git log -8 --oneline
   ```

6. Preserve any concurrent uncommitted work. Stage explicit paths only.
7. Identify the **first track whose bar is not met**. Work only on that
   track, or on the first unfinished unit listed under “Now” below if the
   ledger is more specific. If none, run the `LOOP-VERIFY.md` sweep.
8. If you are mid-unit, finish it (commit or revert) before starting another.
9. Update `LOOP-PROGRESS.md` at the start if the ledger is stale, and again
   after every committed unit with shas, tests, and deployment evidence.
10. Stop looping when the definition of done is met. Write the handover and
    wait. Do not invent a next phase.

`/home/james/quackback` on `gauntlet/tenant-isolation-probe` is **not** an
implementation tree. Do not commit loop work there.

---

## Where you work

| Boundary      | Path                                  | Branch | Rule                       |
| ------------- | ------------------------------------- | ------ | -------------------------- |
| Workspace app | `/home/james/quackback-wt/saas-merge` | `saas` | Only app branch you commit |
| Control plane | `/home/james/quackback-cp`            | `saas` | Only CP branch you commit  |

- Commit small, coherent changes directly to the relevant `saas` branch.
- Do not create a piece branch. Do not change `main` or `next`.
- Do not open a PR unless the operator asks.
- Never add co-author trailers.
- Never name competitor products in source, comments, commits, migrations,
  or fixtures.
- Entity IDs are branded TypeIDs via `@quackback/ids`.
- Cloud surfaces render only when the cloud capability is present. Never
  gate on a hostname, domain, or environment name.

Another agent may share these worktrees. Re-check status before every edit
and commit.

---

## The customer outcome

A new SaaS owner can:

1. receive a generated workspace immediately after control-plane sign-in,
   with no name, URL, region, or plan form;
2. open it through a ten-minute, owner-bound, single-use OTT without
   authenticating again;
3. set a display name and a **required** friendly Quackback URL (the
   generated `ws-*` host is never shown or prefilled as the address);
4. answer the outcome question;
5. receive a useful starter artifact;
6. follow one outcome-specific primary action;
7. begin a 14-day Pro trial only after the starter is `created` or
   `configured`;
8. see plan cards and invoices on Plan & billing (catalogue and
   invoice list from the control plane), then upgrade, change plan,
   downgrade, cancel, and update a card through checkout or portal;
9. keep using the product from the latest local billing projection during a
   temporary control-plane outage, with Free as the baseline and named
   limit/entitlement refusals that point at the cheapest plan that lifts them —
   refused in the workspace UI **and** in the server function, for every
   wired limit on the active plan;
10. own up to three live Free workspaces, and unlimited paid ones;
11. transfer ownership, leave a workspace they do not own, switch
    workspaces from inside the product, see usage before a limit
    402, and export or wipe their data / delete the control-plane
    account when they have no live workspaces.

Product-feedback owners are never required to install the widget. Customer
support owners get the focused Messenger installer. Help Center and
internal-feedback owners get their own continuation. Self-host shows no
trial, billing CTA, or control-plane dependency.

Success is that stranger walk, **twice**, on the live Development fleet.
Green tests are necessary and not sufficient.

---

## Settled decisions — do not relitigate

If evidence shows one is physically impossible, stop and ask. Do not
silently invert them.

1. Compute is Railway, pooled, always-warm. `QUACKBACK_TENANCY=pooled`.
2. Data is Neon, one project per workspace. Postgres stays. D1 is out.
3. Workers-as-app-tier is out. Cloudflare’s job is DNS, the wildcard, and
   later Cloudflare for SaaS custom hostnames.
4. Cloud is a capability, default off.
5. The control plane is the sole billing authority and the sole owner of
   cloud identity, provider keys, webhooks, catalogue, and signed
   projections. A workspace asks with its instance credential; it never
   acts with a platform secret. No workspace id is authority.
6. There is no general cloud gateway.
7. Display name, friendly platform URL, and customer domains are
   control-plane-owned and projected back. Immutable provisioning
   identifiers are never derived from a mutable name or URL.
8. A trial is not a lockout. Stored/projected Free remains the baseline.
   Trial sits beside it. `now >= expiresAt` falls back to Free. No
   sweeper, no suspension, no second trial.
9. Amputate, do not dual-mode, on the `saas` control plane. Do not touch
   `quackback-cp` `main` or the k8s fleet.
10. One fleet object bucket, keys prefixed by workspace id.
11. Customer UI on the control plane is a workspace list plus create.
    Members, billing, trials, and domains live in the workspace. The
    first-workspace ready state auto-opens via POST
    `/api/instances/:id/open`. The dashboard is not a pre-handoff step.
12. Redis restore is parked. The control plane still needs Redis for rate
    limiting; do not spend a track “cleaning that up.”
13. First-win invitations are optional except the explicit
    internal-feedback outcome. Branding and integrations are always
    optional polish. Hosted account ops (Track 8) still require
    invite / remove / change-role to exist and to honour seat limits.
14. Stored asset refs are host-independent (`/api/storage/<key>`). Email,
    widget, OG, and other off-host leaves absolutize from the immutable
    system host at send/render time. Do not bake a friendly URL or
    request Host into `contentJson`.
15. A signed-in user may own at most **three live Free workspaces** at
    a time, and **unlimited paid** workspaces. Count is by owner
    (`ownerEmail` / the actor), not by organisation. A workspace is
    Free unless it has an active paid subscription (trial is Free for
    this cap). Delete/purge or upgrading to paid frees a Free slot.
    The fourth Free create **or restore** fails closed with a
    distinguishable reason. Soft-deleted workspaces are not live.
16. Hosted account operations (Track 8) are in scope: transfer
    ownership, leave, in-product workspace switcher, visible usage,
    export / wipe, delete the control-plane account, seats, and the
    SSO downgrade path. Ownership is `ownerEmail` on the control
    plane. A seat is a workspace teammate (admin/member with a
    login), not a portal user. Advertised stickers are per-seat from
    the CP catalogue; Stripe checkout is still one line item per
    workspace until seat billing is wired. Usage is shown before a 402.
17. The advertised plan catalogue (prices, highlights, add-ons,
    invoices list) lives on the control plane. Workspaces GET
    `/api/v1/internal/billing/catalogue` and `/invoices`. They do not
    keep a parallel price list. Annual is ten months (two free).
18. Every wired numeric limit and entitlement is reviewed as a
    **plan matrix** (Free / Growth / Pro / Scale / trial / expired /
    canceled / self-host). Enforcement numbers come from CP
    `plans/definitions.ts`; grants come from `PLAN_GRANTS` and must
    match workspace `PLAN_CATALOGUE`. The workspace UI and the
    server-fn both refuse. Advertised catalogue stickers must match
    enforcement. Unwired keys (`aiAssistant`, `apiAccess`,
    `ipAllowlist`, `aiFeedbackExtraction`, API rate counters) stay
    parked. The cycle is `LOOP-VERIFY.md` §H.

When documents disagree, authority is: this prompt, then
`LOOP-SAAS-FIRST-CUSTOMER.md`, then `LOOP-VERIFY.md` for the hosted
sweep, then `LOOP-PROGRESS.md` for live evidence, then
`SAAS-HOSTING-STACK.md`, then `CLAUDE.md`. Gauntlet docs and old piece
lists are history.

---

## Now — first incomplete unit

Verified 2026-08-14. Re-check before acting.

**Revisions**

- App `saas` tip `4d1b582c8`. Live app image is `98212c18c` as
  `ghcr.io/quackbackio/quackback@sha256:b3ff89f240c184bec4beefc775bd06959bfb9e2d1c0ef393379ae90e0529fc5f`.
- CP `saas` tip `a040f78`. Live Railway deploy `07d5737e`
  (`sha256:ffdd51a26023233f03c99ded29153317622beeee342b012de3fd75367e3dfe1c`)
  from a concurrent CLI `railway up`. SSR `/setup` is auto-create; the
  setup chunk fails to hydrate because it imports `node:crypto`.
  Control-database migrations `0063`–`0067` were already applied. Local
  app fixture DBs are at `0262`.

**Fleet**

- Railway workspace **Development** `e80b804d-e470-4f7c-9cd6-c61891d74cc7`.
- Project `quackback-pooled-gauntlet` `bd11fc75-db00-4940-b70c-4bddeed30a9f`.
- Environment `production` `aa05f0e8-eeec-4d72-a0d3-c074ee434568`.
- Control plane: `https://cp.quackback.co.uk`.
- Workspaces: `*.quackback.co.uk` (wildcard live).
- Web/worker/crons/migrator were verified on the digest above.
  Web and most roles: `us-east4-eqdc4a`. Do not leave web on `sfo`.
- All nine enrolled workspace DBs were reconciled to
  `0262_cloud_identity_projection`. `MIN_SCHEMA_VERSION` is still
  `0258_workspace_key_columns`.
- Off limits: Railway workspace “James Morton's Projects”,
  `feedback.quackback.io`, k8s/Duckpond, `next`, `main`.

**Track status**

| Track                            | Bar                                                          |
| -------------------------------- | ------------------------------------------------------------ |
| 0 contextual activation          | met in tests                                                 |
| 1 zero-input create + identity   | implemented; live proof **not** met                          |
| 2 focused widget activation      | met in tests                                                 |
| 3 CP billing foundation          | implemented; live verification pending                       |
| 4 workspace projection + gateway | implemented; live verification pending                       |
| 5 authoritative starter trial    | implemented; live verification pending                       |
| 6 remove workspace billing       | implemented; boundary scan pending                           |
| 6b remove stale SaaS code        | local fixture at 0262; leftover columns / plan-fanout remain |
| 7 first-win + operational proof  | infrastructure only                                          |

Historical test-mode checkout walks proved the **old** workspace-owned
billing path. They do not close tracks 3–7.

**Compatibility with the live fleet (do not invert):**

- New creates derive `ws-<24hex>.quackback.co.uk` and write
  `cp_workspace_identity` + hostname claims + identity outbox. They
  write leftover `cp_instances.name = ''`. Display name lives only on
  `cp_workspace_identity` (default `Untitled workspace`).
- All 13 existing Development instances (the `walk-*` / gauntlet rows)
  have names and old hostnames, **zero** identity rows, and **zero**
  hostname claims. They route. They are not identity-capable. Do not
  backfill their names. Do not use them for details/rename proof.
  Gauntlet `neon-t1` / `neon-t2` still store a bare system hostname, not
  an FQDN.
- Workspace billing tables are dropped. Checkout cannot create a
  workspace. Trial starts only from a `created`/`configured` starter.
- Custom domains are not in the Track 1 close bar. Do not revive
  `cp_instances.custom_domain*`.
- `/home/james/quackback/LOOP-SAAS-FIRST-CUSTOMER.md` (gauntlet checkout)
  is a superseded prompt: named create, app-owned billing, provision-time
  trial. Ignore it.

**This wakeup’s unit:** follow `LOOP-PROGRESS.md` “Next commits” and
“Pickup for critics”. Do not restart Units A–C or the setup-chunk
`node:crypto` fix — those are live. Current queue in short:

1. **Fleet first.** Deploy undeployed customer-visible tips in one
   pair: CP `4da4607` (8b siblings); app `804853ae2` (8b switcher) +
   `1a39cd7d7` (Ready/URL) + `6418785c8` (catalogue cards). Then a
   **live** critic on the new digest (not vitest-only). Catalogue
   API `2fb9488` is already an ancestor of live CP `0b85cd0` — prove
   the GETs after the app cards land.
2. After that digest is live: Verify sweep + Plan-matrix §H.
3. Then 8c transfer/leave. Do not start 8c while 8b is committed and
   not live.
4. Cloudflare: identity gateway + workspace Domains card on the
   existing client. Fallback origin is already active on Railway.

Do not raise `MIN_SCHEMA_VERSION` unless the walk requires it and every
enrolled workspace is already at the new floor.

---

## Deploy + live-verify (same fire)

“Do not deploy yet” is withdrawn. The named-create screenshot exists
because we stopped deploying. A fire that commits customer-visible
work and leaves `Live? no` in the pickup table is **incomplete**.

**Customer-visible** means a stranger (or an existing `ws-*` owner)
would see or call it: create, Open, onboarding, settings, billing,
switcher, limits, catalogue cards, identity, storage URLs.

**Same-fire sequence** when tests are green and the app/CP pair is
compatible:

1. Merge isolated worktrees serially onto `saas`.
2. **Fleet** deploys the affected side (batch undeployed tips into
   one CP image and one app image when pairing makes sense).
3. Wait until Railway `SUCCESS`. Confirm `meta.imageDigest` matches
   the new image. Reassert `us-east4-eqdc4a` on web. If CP SQL or
   workspace schema changed, confirm migrations actually ran.
4. Spawn a **live** critic on those URLs (Bar A). Record digest +
   verdict in `LOOP-PROGRESS.md`.
5. Run Verify (`LOOP-VERIFY.md`) against that digest if this fire
   has not already.

Children on isolated worktrees still **must not** merge or deploy.
The orchestrator merges, then **must** take Fleet in the same fire.

**Named skips** (write the skip in the ledger; otherwise deploy):

- Ledger-only / docs-only commits (`docs(loop):` with no product change).
- Isolated worktree **before** serial merge.
- Focused tests not green.
- Pair incompatible (app needs a CP tip that is not ready, or the
  reverse) — deploy the ready side, or wait one fire with the
  incompatibility written down.
- Fleet already deploying this fire (one thread) — finish and
  live-verify **that** deploy; queue the other side as the next unit.
  Do not skip verification of what you shipped.
- Operator skip-deploy (Cloudflare token on CP env, no code change).
- Stop-and-ask (live Stripe key, extra spend, destroy-list apply).

**Not a skip:** “leave deploy for the next fire”, “critic IDs did not
join”, “we re-ran vitest”, “Docker is still pending so start 8c”.
If a critic task is unjoinable, the orchestrator live-probes itself
or spawns a joinable critic before stopping. Local green tests do
not sign a customer-visible unit.

Wakeup rule: if the pickup table has `Live? no` on a customer-visible
sha and a named skip does not apply, **Fleet is the current unit**.
Do not start the next builder on top of undeployed tips.

---

## How to work a unit

1. One coherent change. Test it. Commit it. Record it.
2. Focused tests for the unit you touched. Do not disable, skip, or
   weaken a test to pass a bar.
3. **Deploy in the same fire** when the unit is customer-visible, the
   pair is compatible, and those tests are green. See “Deploy +
   live-verify”. Ledger-only commits do not deploy.
4. **Then spawn a critic on the live URLs** (after the digest is
   confirmed). Fresh agent. Give it only: the track goal, the bar,
   the commit range, and the live URLs. It does not see your
   reasoning or self-assessment. It must exercise the live system.
   A critic that only reads the diff, or only re-runs vitest, has
   not signed. Discard that verdict and re-run it. Record the
   critic’s verdict and the live digest in `LOOP-PROGRESS.md`
   before you stop.
5. **Then run Verify** (`LOOP-VERIFY.md`) against that digest if this
   fire has not already. If §H has not been signed against the
   current live image pair, spawn the Plan-matrix critic. Spawn a
   Fixer only for HIGH SIGNAL findings that are not stop-and-ask
   (Cloudflare for SaaS, live Stripe key). The fixer does not merge
   or deploy; you merge, deploy if customer-visible, then a live
   critic.
6. Status back to the parent must include: what the builder did,
   whether it is live (`meta.imageDigest`), and the critic’s
   pass/fail plus one-line reason. `committed, not deployed` is a
   fail unless a named skip is recorded.
7. Fresh-mailbox OTPs for the Development CP are readable in
   `cp_verifications`. Do not use the operator’s mailbox as proof.
8. New workspaces get generated `ws-*` hostnames and `qb_*` database
   names. Do not ask the customer for a `walk-` label. If you create a
   disposable Neon project yourself, prefix it `walk-` and state expected
   monthly cost first. If extra spend would exceed **$50/month** above
   the current Development baseline, stop and ask.
9. Do not delete existing `walk-*` workspaces without a fresh registry
   check. `walk3-mss0m53h` must remain until the obsolete workspace-side
   fleet webhook is deliberately retired. Those rows are not identity
   proof.

---

## Deployment mechanics (verified 2026-08-14)

- `docker.yml` builds `saas` only through `workflow_dispatch`.
- After changing `source.image`, deploy with `serviceInstanceDeployV2`
  or `railway redeploy --from-source`. Plain redeploy reuses the prior
  image.
- Verify `meta.imageDigest` on the new deployment. Configured source is
  not proof.
- After an image change, reassert and verify `us-east4-eqdc4a` on web.
- A cron service `SUCCESS` after a config change is **not** proof the
  job ran. To execute the migrator now, clear `cronSchedule`, run the
  start command, then restore `47 2 * * *` and
  `bun /app/fleet-migrator.mjs enrol && bun /app/fleet-migrator.mjs run`.
- `enrol && run` is a no-op if targets are already current. Raise the
  target (`set-target --target <tag>`) before expecting new SQL.
- A live CP **code** deploy does not imply its SQL ran. Confirm
  `drizzle.__drizzle_migrations` and the physical columns/enums.
- Additive workspace SQL must land before the code that selects those
  columns. `0261` is already applied on the enrolled fleet; do not
  re-apply it as if the old billing image were still serving.
- Gauntlet `t1`/`t2` have historically gapped ledgers. Mutating replay
  (`0260`) is refused unless `--allow-mutating-replay` is justified.
- Never `railway link` ambiently. Explicit project / environment /
  service ids only.
- Do not `apply` `.railway/railway.ts` without inspecting the complete
  destroy list. Absence of a resource is a deletion. The committed
  Railway file was **not** applied in the earlier loop.
- `railway up --detach` is not done. Poll until `SUCCESS`.
- Do not rotate, reset, or reprint production-shaped secrets.
- Do not print Railway or Neon credentials into the ledger or chat.

---

## Bars that apply to every track

**Bar A — live stranger walk.** A critic uses a fresh mailbox, performs
the track’s customer action, and records URLs, status codes, and
screenshots or HTTP transcripts.

**Bar B — fail closed, named.** Every refusal has a distinguishable
reason. Silent no-ops are failures of the track that introduced them.

**Bar C — self-host unchanged.** With cloud absent, no trial banner, no
upgrade modal, no billing nav, no cloud URL/domain controls.

**Bar D — hosted product sweep.** The latest `LOOP-VERIFY.md` sweep has
no open HIGH SIGNAL rows. Per-unit green tests do not close this bar.

**Bar E — plan matrix, UI + server.** Every wired numeric limit and
entitlement is refused on the matching active plan in the workspace
UI _and_ in the server-fn / REST that would create it. Catalogue
stickers match enforcement. See `LOOP-VERIFY.md` §H. A spot-check of
one Free cap does not close this bar.

**Bar F — live when customer-visible.** A committed unit that changes
what a stranger sees or can call is not done until it is on the live
Development pair (`meta.imageDigest` matches) and a critic has
exercised those live URLs. Parking the deploy is incomplete unless a
named skip in “Deploy + live-verify” applies.

---

## Stop and ask when

- A settled decision appears physically impossible.
- You need a live (non-test) Stripe key, a public git tag / OSS release,
  or a spare real domain for custom hostnames.
- Any action would touch the off-limits Railway workspace or a real
  customer.
- Projected extra spend exceeds the cap.
- The same unit fails its critic **three** times on the same gap.
  Report the gap; do not lower the bar.
- You want to restore Redis/BullMQ, build a gateway, start a Workers
  port, migrate the k8s fleet, or open a new branch.
- You are about to disable a test.
- `railway config plan` proposes deleting a resource the fleet still
  uses.

Do **not** stop to ask permission to implement a unit this file already
names. Do not stop to propose a new architecture. Do not stop because
the old gauntlet task list still has open items.

Carried operational defects — diagnose only if they block the current
unit:

- Control-plane purge sweep logs `deprovision.failed`.
- `cp-t2crit.quackback.co.uk` has been stranded in `provisioning` since
  2026-08-09.
- Control plane still requires Redis for rate limiting.

---

## What you will not do

- New hosting providers, a cloud gateway, Workers-as-app, D1, Hyperdrive.
- Dual-mode CP, or any change to `quackback-cp` `main`.
- Redis / BullMQ restoration.
- Migrating existing cloud tenants.
- The 18 new entitlement keys, add-on catalogue, invoice PDFs, dunning
  beyond “update your card.”
- New gauntlet pieces, new specs, new hosting essays.
- Editing this prompt to expand the mission.
- Claiming a track closed from tests alone, or from the pre-correction
  checkout walks.
- Parking a customer-visible deploy or live critic for “the next
  fire” when no named skip applies.

---

## Definition of done

All of the following, with evidence in `LOOP-PROGRESS.md`:

- Two fresh owners receive a workspace with no pre-handoff questions and
  complete Open without authenticating again.
- Cloud name, platform URL, and (once enabled) custom-domain mutations
  traverse the instance-scoped control-plane gateway. Self-host shows
  none of those controls.
- Each outcome reaches its tailored starter and never sees an irrelevant
  widget prompt.
- A real `created`/`configured` starter begins one immutable Pro trial.
- Test-mode checkout, plan change, portal (downgrade / cancel / card),
  and webhook finalize traverse the control-plane gateway. Free limits
  and entitlements refuse with a named plan; a paid overlay lifts them.
- Cross-workspace isolation, replay, out-of-order projection, retry,
  outage, and exact-expiry probes pass.
- Self-hosted setup shows no cloud commercial surface.
- Custom domains stay disabled until hostname and certificate readiness
  are live-proved.
- The ledger records commits, tests, deployments, and remaining
  operational blockers.
- Soft-delete does not count toward the three Free slots; restore of a
  Free workspace re-checks the cap.
- The workspace has an in-product switcher, owner transfer, leave, and
  visible `N of M` usage for finite limits (including `N of 3` Free
  workspaces on the CP list).
- Invite / remove / change-role honour Free seat limits; SSO
  downgrade still lets admins in.
- The latest hosted-product sweep (`LOOP-VERIFY.md`) has no open HIGH
  SIGNAL findings.
- The latest plan-matrix critic (`LOOP-VERIFY.md` §H) is signed
  against the current live image pair: every wired limit and
  entitlement, UI and server, on each active-plan state.
- Every customer-visible commit in the pickup table is live
  (`meta.imageDigest`) with a live critic, or has a named skip.

Then **stop**. Do not start a new phase.
