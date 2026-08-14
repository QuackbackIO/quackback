# Loop: First SaaS Customer

This is the lead-agent runbook for completing one first-customer journey on the
two `saas` branches.

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

1. create one workspace from the control plane;
2. open it through a single-use handoff without authenticating again;
3. answer only the outcome question;
4. receive a useful starter artifact;
5. follow one outcome-specific primary action;
6. begin a 14-day Pro trial only after the starter is created or configured;
7. upgrade or manage billing from the workspace through the control plane; and
8. keep using the product from the latest local billing projection during a
   temporary control-plane outage.

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
  billing APIs never accept a workspace id as authority.
- Return URLs come from the control-plane registry and an allowlist.
- Trial end is a clock-based fallback to the projected Free state, not a
  suspension.
- Invitations are optional except for the explicit internal-feedback outcome.
- Branding and integrations are always optional polish.

## Wake-up protocol

At the start of each work period:

1. Read this file, `SAAS-HOSTING-STACK.md`, and `LOOP-PROGRESS.md`.
2. Inspect status and recent commits in both worktrees.
3. Preserve concurrent uncommitted work and identify the first incomplete track.
4. Finish, test, and commit one coherent unit before starting another.
5. Update `LOOP-PROGRESS.md` with the commit and verification evidence.
6. Deploy only when the app/control-plane pair is compatible and focused tests
   are green.

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

### Track 1: Owner handoff and tailored starter

Outcome: control-plane Open establishes the provisioned owner’s workspace session
through a ten-minute, owner-bound, single-use OTT. The workspace shows only the
goal question and routes the final action to the tailored starter.

Bar: fresh-browser tests cover success, replay, expiry, wrong workspace, and
sign-in-only behavior for non-owners.

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
- provider data never appears in projection payloads.

### Track 4: Workspace projection and gateway

Outcome: a workspace verifies signed projections, atomically accepts only a
higher version, caches the latest projection, and uses it for UI and enforcement.
Upgrade, Change plan, and Manage billing proxy to the control plane and return a
303 to its hosted URL.

Bar:

- invalid signatures and stale versions are rejected;
- repeated versions are idempotent;
- active trial and paid limits overlay in the least-restrictive direction;
- `now >= expiresAt` falls back exactly to projected Free limits;
- a control-plane outage preserves existing access and makes billing actions
  retryable;
- self-host remains on its existing limits path.

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

### Track 7: First-win and operational proof

Outcome: typed PLG events remain privacy-safe structured logs, and the complete
fresh-browser journeys work for product feedback, customer support, Help Center,
internal feedback, and self-hosted setup.

Bar: logs can derive step conversion, CTA click-through, time to starter, time to
first win, defer rate, and trial-start failures without email, content, URLs, or
tokens.

## Deployment order

1. Control-plane billing gateway, ledger, catalogue validation, projection API.
2. Workspace projection consumption and enforcement.
3. Workspace billing-action gateway routes.
4. Control-plane trial activation.
5. Workspace provider-integration removal.
6. Cross-system and live first-customer verification.

Do not deploy a workspace build that has removed direct billing until its paired
control-plane gateway and projection producer are ready.

## Definition of done

- Both `saas` branches are clean and contain small, reviewed commits.
- All eight tracks meet their focused bars.
- Two fresh owners complete the handoff journey without repeated auth or naming.
- Each outcome reaches its tailored starter and never sees an irrelevant widget
  prompt.
- A real created/configured starter begins one immutable Pro trial.
- Test-mode checkout and portal actions traverse the control-plane gateway.
- Cross-workspace isolation, replay, out-of-order projection, retry, outage, and
  exact-expiry probes pass.
- Self-hosted setup shows no cloud commercial surface.
- `LOOP-PROGRESS.md` records commits, test evidence, deployments, and remaining
  operational blockers.
