# /loop — First SaaS customer

Paste this file as the wakeup prompt. Then work until the current unit is
committed and recorded, a stop-and-ask fires, or the definition of done is
met. Do not paraphrase this into a new mission.

You are the **lead agent**. Implement yourself, serially, on the two `saas`
branches. Spawn **critics only** — never parallel builders, never piece
branches, never extra worktrees for independence.

The previous long run died of decomposition. Do not repeat that shape.

---

## Wakeup — do this before any edit

1. Read `/home/james/quackback-wt/saas-merge/LOOP-SAAS-FIRST-CUSTOMER.md`.
2. Read `/home/james/quackback-wt/saas-merge/LOOP-PROGRESS.md`.
3. Read `/home/james/quackback-wt/saas-merge/SAAS-HOSTING-STACK.md` only as
   needed for a platform question.
4. Inspect, do not assume:

   ```bash
   git -C /home/james/quackback-wt/saas-merge status -sb && git log -8 --oneline
   git -C /home/james/quackback-cp status -sb && git log -8 --oneline
   ```

5. Preserve any concurrent uncommitted work. Stage explicit paths only.
6. Identify the **first track whose bar is not met**. Work only on that
   track, or on the first unfinished unit listed under “Now” below if the
   ledger is more specific.
7. If you are mid-unit, finish it (commit or revert) before starting another.
8. Update `LOOP-PROGRESS.md` at the start if the ledger is stale, and again
   after every committed unit with shas, tests, and deployment evidence.
9. Stop looping when the definition of done is met. Write the handover and
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
3. optionally set or skip display name and friendly Quackback URL;
4. answer the outcome question;
5. receive a useful starter artifact;
6. follow one outcome-specific primary action;
7. begin a 14-day Pro trial only after the starter is `created` or
   `configured`;
8. upgrade or manage billing from the workspace through the control plane;
9. keep using the product from the latest local billing projection during a
   temporary control-plane outage.

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
13. Invitations are optional except the explicit internal-feedback outcome.
    Branding and integrations are always optional polish.
14. Stored asset refs are host-independent (`/api/storage/<key>`). Email,
    widget, OG, and other off-host leaves absolutize from the immutable
    system host at send/render time. Do not bake a friendly URL or
    request Host into `contentJson`.

When documents disagree, authority is: this prompt, then
`LOOP-SAAS-FIRST-CUSTOMER.md`, then `LOOP-PROGRESS.md` for live evidence,
then `SAAS-HOSTING-STACK.md`, then `CLAUDE.md`. Gauntlet docs and old
piece lists are history.

---

## Now — first incomplete unit

Verified 2026-08-14. Re-check before acting.

**Revisions**

- App `saas` tip `a796b8885`. Last **deployed** app image is `58eebd173`
  as
  `ghcr.io/quackbackio/quackback@sha256:496d295f1d87bf71e82e3f26913b9954a8ffde530f90242769ad9592aca44f30`.
- CP `saas` tip `a040f78`. Live Railway deploy `7eca55b3`
  (`sha256:2b0276a2a49a38526dcbfbf1ea09c926c1d9f45524356b4d7185ca720470f1c8`).
  SSR `/setup` is auto-create; the setup chunk fails to hydrate because
  it imports `node:crypto`. Control-database migrations `0063`–`0067`
  were already applied. Local app fixture DBs are at `0262`.

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

**This wakeup’s unit, in order:**

1. ~~**Unit A — deploy the current CP.**~~ Live `7eca55b3` (`a040f78`).
   Auto-create SSR screenshot `loop-evidence/unit-a-setup.png`.
2. ~~**Unit B — auto-open when ready.**~~ Deployed with A; live
   OpeningPane is blocked until the setup chunk hydrates.
3. ~~**Unit C — host-independent stored assets.**~~ App `a796b8885`
   (not deployed). Persist `/api/storage/<key>`; leaves absolutize
   from the system host.
4. Finish the in-flight CP setup-chunk isolation so the browser does
   not import `node:crypto`. Redeploy CP. Do not revert concurrent
   `.server.ts` work.
5. Fresh-browser prove the **deployed** pair with **two** mailboxes the
   operator does not own, on **new** generated hosts:
   - control-plane sign-in
   - first workspace created with no name/URL/region/plan form
   - auto-open establishes the session via one-use OTT (no dashboard)
   - skippable Workspace details, then the outcome question
   - rename of the friendly URL, old host redirects, session survives
   - stored image src stays `/api/storage/…` across rename
   - replay / expiry / wrong-workspace OTT fail closed

Do **not** start Cloudflare for SaaS, the custom-domain manager, or the
billing live bar until that walk passes. Do not raise
`MIN_SCHEMA_VERSION` unless the walk requires it and every enrolled
workspace is already at the new floor.

After every CP or app unit that changes customer-visible create, open,
identity, or storage URLs, deploy the affected side, verify
`meta.imageDigest` (and CP SQL / fleet-migrator if schema changed),
reassert `us-east4-eqdc4a` on web, and record one live probe. Do not
redeploy on ledger-only commits. “Do not deploy yet” is withdrawn —
the named-create screenshot exists because we stopped deploying.

---

## How to work a unit

1. One coherent change. Test it. Commit it. Record it.
2. Focused tests for the unit you touched. Do not disable, skip, or
   weaken a test to pass a bar.
3. Deploy only when the app/control-plane pair is compatible and those
   tests are green.
4. A critic is a fresh agent given only: the track goal, the bar, the
   commit range, and the live URLs. It does not see your reasoning or
   self-assessment. A critic that does not exercise the live system has
   not signed. Discard that verdict and re-run it.
5. Fresh-mailbox OTPs for the Development CP are readable in
   `cp_verifications`. Do not use the operator’s mailbox as proof.
6. New workspaces get generated `ws-*` hostnames and `qb_*` database
   names. Do not ask the customer for a `walk-` label. If you create a
   disposable Neon project yourself, prefix it `walk-` and state expected
   monthly cost first. If extra spend would exceed **$50/month** above
   the current Development baseline, stop and ask.
7. Do not delete existing `walk-*` workspaces without a fresh registry
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
- Test-mode checkout and portal actions traverse the control-plane
  gateway.
- Cross-workspace isolation, replay, out-of-order projection, retry,
  outage, and exact-expiry probes pass.
- Self-hosted setup shows no cloud commercial surface.
- Custom domains stay disabled until hostname and certificate readiness
  are live-proved.
- The ledger records commits, tests, deployments, and remaining
  operational blockers.

Then **stop**. Do not start a new phase.
