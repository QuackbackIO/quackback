# SaaS Hosting Stack

Status: canonical architecture for the `saas` branches  
Updated: 2026-08-14

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
- A real `role=web` service was verified to sleep successfully. Pooled compute
  remains the default; the experiment carried no customer traffic.
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

Billing remains presented inside the workspace:

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

The control plane supplies workspace identity and owner identity. Opening a
workspace uses a ten-minute, owner-bound, single-use OTT. The workspace consumes
the token, strips it from the URL, establishes its local session, and fails closed
to a clear sign-in/retry screen for invalid, expired, replayed, or wrong-workspace
tokens.

Provisioned owners answer only the outcome question. Product activation exposes
one contextual primary action per surface. Widget installation is required only
for customer-support Messenger activation and remains optional for product
feedback.

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
