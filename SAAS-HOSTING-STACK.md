# SaaS Hosting Stack

Status: canonical architecture for the `saas` branches  
Updated: 2026-08-17

## System shape

Quackback Cloud has two application boundaries:

- The control plane owns fleet identity, workspace provisioning, commercial
  billing, and versioned projections of commercial state.
- A workspace owns product data and the in-product customer experience. It
  remains usable from locally cached state when the control plane is unavailable.

The deployed platform remains:

- Railway pooled, always-warm application compute.
- Neon Postgres, one project and database boundary per workspace.
- Cloudflare wildcard routing and customer hostnames.
- One fleet object bucket, with workspace-prefixed keys derived from the same
  verified tenant scope as the database connection.

Self-hosted deployments do not depend on the control plane and do not show cloud
commercial UI.

### As-built fleet notes

- The workspace app no longer reads Redis. The control plane still requires
  `REDIS_URL` for rate limiting, so the Railway Redis service cannot be removed
  until that setting becomes optional and its failure mode is explicit.
- The fleet uses one object bucket. Five obsolete per-workspace `qb-*` probe
  buckets and the completed `quackback-web-sleeper` experiment were deleted on
  2026-08-14.
- A real `role=web` service was verified to sleep successfully. That split is
  no longer required: the tenant-facing `quackback` service now runs
  `QUACKBACK_ROLE=all` with the connectionless scheduler, so it can drain jobs
  without holding a tenant LISTEN. `quackback-worker` stays declared until a
  later apply after soak; live delete is separately gated.
- The control-plane purge sweep currently logs `deprovision.failed`; this is an
  operational defect carried into the new loop.

## Tenant boundary

Workspace resolution is security-critical. A request must resolve one tenant
scope containing the registry instance id, database URL, expected database
fingerprint, encryption material, and object-storage prefix. Database checkout
must refuse a mismatched workspace stamp or Neon project/branch identity.

Mutable process state, caches, rate limits, authentication instances, queue
leases, and external clients must be keyed by workspace. Authorization cannot
repair a wrong database selection because the selected database is internally
self-consistent.

## Workspace creation and cloud identity

Cloud workspace creation is zero-input. After control-plane authentication, a
customer with no workspace receives one immediately; creation never asks for a
display name, URL, region, or plan. The control plane generates the immutable
instance id, database/role names, tenant namespace, mail slug, and a
non-customer-facing system hostname from opaque identifiers rather than from
customer-facing text.
Provisioning may remain asynchronous, but the customer sees progress and then
crosses the existing one-time-token handoff into the workspace.

Display name, the friendly Quackback URL, and custom domains are post-handoff
workspace settings. The first in-workspace journey requires a name and a
friendly URL before the outcome question; the generated system host is never
shown or prefilled as the customer address. The same name/URL controls remain
under Admin Settings → General. Custom domains use a workspace Domains
surface on the same control-plane identity gateway once the hostname
provider is live. Self-host keeps local name editing and never renders
cloud URL or domain controls.

For a cloud workspace, the control plane owns this identity state just as it
owns billing state. The workspace renders the UI, checks the local administrator
permission, and calls an instance-scoped control-plane endpoint through its
derived credential. The control plane derives the workspace from the credential;
no identity API accepts a caller-supplied workspace id as authority. Name, URL,
and domain mutations fail with a retryable message during a control-plane outage
while the last accepted identity continues to serve locally.

The control plane returns identity through a workspace-safe, signed, monotonic
projection. A successful mutation response carries the accepted signed
projection so the workspace can verify and apply it synchronously; the
control-plane outbox redelivers the same version until acknowledged. It contains
only the projection version, display name, canonical origin, platform hostname,
custom-domain names and safe verification states. Provider ids, validation
secrets, credentials, and tokens stay in the control plane. Self-hosted
workspaces keep local display-name editing and receive no cloud URL/domain
controls or control-plane dependency.

### Platform URL changes

The customer edits only the first DNS label. The control plane validates the
reserved-name and shape policy, atomically reserves the new hostname in the
fleet-unique hostname table, and changes `primaryHostname` and `baseUrl` in the
same registry transaction. Billing return URLs and every other canonical-origin
consumer continue to derive from that registry.

Provisioning identity must be separated from the friendly URL. In particular,
database names, roles, tenant namespaces, mail routing, object-storage prefixes,
and the immutable system hostname never change when the customer renames the
workspace. Stored asset refs are host-independent (`/api/storage/<key>`);
email, widget, and other off-host leaves absolutize from the system host
at send/render time. The system hostname is the initial canonical URL and
remains a non-canonical routing alias after a friendly URL is chosen.
Every previous
friendly platform hostname remains permanently reserved to that workspace as a
redirect-only alias; it never serves a second canonical origin and is never
reassigned to another tenant.

Because authentication cookies are host-scoped, a successful rename finishes
with a single-use, current-principal browser handoff to the new canonical origin.
The token is stripped on consumption. A replay, wrong workspace, or expired
handoff fails closed.

This is viable without per-workspace infrastructure mutations. In the
Development deployment, Cloudflare is authoritative for `quackback.co.uk`, its
wildcard DNS record targets the one Railway web service, and Railway terminates a
`*.quackback.co.uk` certificate. Any first-level platform hostname therefore
already reaches the pooled fleet; the control-plane registry decides whether it
belongs to a workspace.

### Customer custom domains

Cloud custom domains appear as a separate card below Workspace details in Admin
Settings > General, not as a competing onboarding requirement. Add, recheck,
make-primary, and remove all go through the same instance-scoped control-plane
client. Entitlement and numeric domain limits come from authoritative
control-plane commercial state and are enforced again at the control-plane
endpoint.

The existing registry ownership challenge is necessary but is not sufficient:
the Railway wildcard certificate covers only platform subdomains. The control
plane must integrate Cloudflare for SaaS Custom Hostnames, own its credentials
and provider references, and expose customer-safe DNS validation instructions.
A domain becomes routable only when ownership is proven, Cloudflare reports both
the hostname and its SSL certificate active, and the customer DNS points to the
configured SaaS target. Only then may the control plane add it to the workspace
hostname set or make it canonical.

Removal first moves the canonical origin back to a verified hostname and updates
the registry; provider cleanup follows idempotently through the control-plane
outbox. The cloud Help Center must link to this shared domain manager rather than
maintain a second cloud certificate path. Its existing local CNAME/reverse-proxy
flow remains available only to self-hosters.

## Billing ownership

The control plane is the sole source of truth for:

- customers, subscriptions, plans, prices, and provider references;
- trial timestamps and eligibility;
- commercial entitlements and numeric limits;
- checkout and billing-portal sessions;
- provider webhooks, reconciliation, and billing history; and
- versioned billing projections sent to workspaces.

Workspaces must not contain provider API keys, webhook secrets, price catalogues,
or authoritative subscription state. Provider identifiers and secrets never
appear in a workspace projection.

### Workspace billing UX

The advertised catalogue (prices, highlights, add-ons) and the invoice
list live on the control plane. The workspace GETs
`/api/v1/internal/billing/catalogue` and `/invoices` and renders Plan &
billing from that payload. It does not keep a parallel price list.
Provider ids never appear in the workspace.

Billing actions remain presented inside the workspace:

1. An authenticated owner selects Upgrade, Change plan, or Manage billing.
2. A workspace server endpoint calls the control plane with its instance
   credential and the requested action.
3. The control plane derives the workspace from that credential. It never trusts
   a caller-supplied workspace id.
4. The control plane creates the hosted provider session using a return URL
   derived from its workspace registry and checked against its allowlist.
5. The workspace responds with a 303 redirect to the provider URL.
6. Provider webhooks update the control-plane ledger.
7. An outbox fans a new projection to the affected workspace.

Checkout and billing management fail with a retryable customer message while the
control plane is unavailable. Normal product access and limit enforcement do not.

Every wired numeric limit and entitlement is refused in the workspace UI
and in the server function for the active plan. The review cycle is
`LOOP-VERIFY.md` §H (Free / Growth / Pro / Scale / trial / expired /
canceled / self-host). Advertised catalogue stickers must match CP
`plans/definitions.ts` and `PLAN_GRANTS`.

### Billing projection

The workspace receives only:

- projection version;
- effective plan;
- trial start and expiry;
- subscription status;
- entitlements;
- Free baseline limits;
- active trial or paid limits and their expiry;
- availability of upgrade and manage-billing actions; and
- optional customer-safe renewal or cancellation dates.

Projection writes are signed, idempotent, and monotonic. A workspace verifies the
signature against its configured control-plane public key, rejects malformed or
stale versions, and commits the projection atomically. Replayed or out-of-order
delivery cannot regress local state.

The latest valid projection is the local enforcement source. At the exact
projected trial expiry instant, effective entitlements and limits fall back to
the projected Free baseline without a sweeper or another control-plane call.
An expired paid projection follows its explicit projected state; the workspace
does not infer provider state.

### Trial activation

A trial starts only after a genuine starter resolution of `created` or
`configured`.

1. The workspace sends an idempotent, instance-authenticated activation event
   containing allowlisted starter evidence.
2. The control plane validates instance identity, evidence shape, and eligibility.
3. It stamps the immutable trial anchor once, records the authoritative event,
   derives the effective Pro projection from its validated catalogue, and queues
   projection delivery.

`deferred`, `unavailable`, and ordinary workspace provisioning never start a
trial. Retrying activation cannot extend it.

## Activation and onboarding

The control plane generates workspace identity and supplies owner identity.
Opening a workspace uses a ten-minute, owner-bound, single-use OTT. The workspace
consumes the token, strips it from the URL, establishes its local session, and
fails closed to a clear sign-in/retry screen for invalid, expired, replayed, or
wrong-workspace tokens.

There is no pre-handoff onboarding form. Provisioned owners may skip or edit
workspace details inside the workspace, then answer the outcome question.
Product activation exposes one contextual primary action per surface. Widget
installation is required only for customer-support Messenger activation and
remains optional for product feedback.

## Availability and consistency

- Workspace reads use the latest locally verified projection.
- Control-plane outbox delivery retries until acknowledged.
- Projection version is monotonic per workspace.
- Webhook processing and starter activation use idempotency keys.
- The immutable trial anchor is control-plane-owned.
- A control-plane outage cannot remove existing product access merely because a
  request cannot refresh billing state.
- Billing actions surface a retryable failure rather than guessing or failing
  open.

## Configuration boundary

Control plane only:

- provider API and webhook credentials;
- commercial catalogue and price identifiers;
- projection signing private key;
- billing ledger and outbox.

Workspace only:

- its instance-scoped control-plane credential;
- projection verification public key;
- latest signed projection;
- non-commercial operator/self-host tier limits.

Cloud billing readiness validates the Pro catalogue and projection signing
configuration at control-plane startup. Workspace readiness never parses a
provider catalogue.

## Rollout order

1. Deploy the control-plane billing gateway, ledger, catalogue validation, and
   projection API.
2. Add signed, versioned projection consumption and local enforcement to
   workspaces.
3. Route workspace billing actions through the gateway.
4. Move trial stamping and eligibility to the control plane.
5. Remove workspace provider clients, catalogues, webhooks, secrets, and
   authoritative subscription fields.
6. Verify cross-workspace isolation, webhook replay, fan-out retry, stale
   projection rejection, exact trial expiry, and control-plane outage behavior.

The workspace projection consumer may land before the producer is deployed, but
provider integration is removed only after the gateway and projection path are
available together.
