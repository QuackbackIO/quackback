# Quackback Cloud - SaaS Platform Plan

**Date:** 2026-02-24
**Type:** Feature (Major)
**Status:** Draft

---

## 1. Executive Summary

Build a cloud-hosted SaaS version of Quackback using a **WordPress.com-like architecture**: each customer gets a fully isolated instance running the identical open-source Docker image, orchestrated by a separate control plane that handles signup, billing, custom domains, and a central OAuth gateway for marketplace registration.

### Core Principles

- **Zero compromise on OSS**: The open-source product stays single-tenant and standalone. Cloud is an orchestration layer around it, not a fork.
- **True isolation**: Each tenant gets its own database, key-prefixed Redis, and path-prefixed S3. No `workspaceId` retrofit.
- **One marketplace registration**: A central OAuth server at `auth.quackback.io` enables a single MCP listing in Claude/ChatGPT marketplaces that works for all customers.
- **Minimal OSS changes**: 7 additive, env-var-gated changes to the OSS codebase. All completely inert in self-hosted mode.
- **Launch lean**: Start with 1 account = 1 workspace, simple OAuth, minimal background jobs. Add complexity only when customers demand it.

---

## 2. Architecture Overview

```
                      ┌─────────────────────────────────────────────────────┐
                      │                 Internet / Clients                   │
                      └───────┬──────────────────┬──────────────┬───────────┘
                              │                  │              │
                    quackback.io        auth.quackback.io   mcp.quackback.io
                              │                  │              │
            ┌─────────────────▼──────────────────▼──────────────▼──────────┐
            │                    Ingress Controller (nginx)                 │
            │                    + cert-manager (Let's Encrypt)             │
            │                    *.quackback.io wildcard TLS                │
            │                    Custom domain TLS via Certificate CRDs     │
            └─────────────────┬──────────────────┬──────────────┬──────────┘
                              │                  │              │
            ┌─────────────────▼──────────────────▼──────────────▼──────────┐
            │              Control Plane (Deployment, 2-3 replicas)         │
            │              Namespace: qb-control-plane                      │
            │                                                              │
            │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
            │  │ Signup &     │  │ Central OAuth  │  │ MCP Proxy &     │  │
            │  │ Billing      │  │ 2.1 Server     │  │ Request Router  │  │
            │  │ (Stripe)     │  │                │  │ (Delegation JWT │  │
            │  │              │  │                │  │  signing)       │  │
            │  └──────────────┘  └───────────────┘  └──────────────────┘  │
            │                                                              │
            │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
            │  │ Provisioning │  │ Tenant Router  │  │ Custom Domain   │  │
            │  │ Service      │  │ (Host→Instance │  │ Manager         │  │
            │  │ (K8s API)    │  │  Proxy)        │  │ (cert-manager)  │  │
            │  └──────────────┘  └───────────────┘  └──────────────────┘  │
            └──────┬────────────────────┬──────────────────────────────────┘
                   │                    │
                   │ provisions &       │ routes requests to
                   │ manages            │
    ┌──────────────▼────────────────────▼──────────────────────────────────┐
    │     Tenant Namespaces (one per customer, KEDA scale-to-zero)         │
    │                                                                      │
    │  ┌────────────────────┐  ┌────────────────────┐                      │
    │  │ ns: qb-t-acme      │  │ ns: qb-t-beta      │  ...                │
    │  │                    │  │                    │                      │
    │  │ Deployment (1 pod) │  │ Deployment (1 pod) │                      │
    │  │ Service (ClusterIP)│  │ Service (ClusterIP)│                      │
    │  │ ScaledObject (KEDA)│  │ ScaledObject (KEDA)│                      │
    │  │ NetworkPolicy      │  │ NetworkPolicy      │                      │
    │  └───────┬────────────┘  └───────┬────────────┘                      │
    └──────────┼───────────────────────┼───────────────────────────────────┘
               │                       │
    ┌──────────▼───────────────────────▼───────────────────────────────────┐
    │                     Shared Infrastructure Namespace                   │
    │                     ns: qb-infra                                      │
    │                                                                      │
    │  ┌───────────────────────┐  ┌───────────────┐  ┌────────────────┐   │
    │  │ PostgreSQL + PgBouncer│  │ Dragonfly      │  │ S3 Bucket      │   │
    │  │ (CloudNativePG or     │  │ (StatefulSet,  │  │ (Cloudflare R2 │   │
    │  │  managed RDS/Cloud SQL│  │  shared Redis)  │  │  or AWS S3)    │   │
    │  │  with pgvector)       │  │                │  │                │   │
    │  │                       │  │ t:acme:*       │  │ /tenants/acme/ │   │
    │  │ PgBouncer pool        │  │ t:beta:*       │  │ /tenants/beta/ │   │
    │  │ DB: control_plane     │  │                │  │                │   │
    │  │ DB: tenant_acme       │  │                │  │                │   │
    │  │ DB: tenant_beta       │  │                │  │                │   │
    │  └───────────────────────┘  └───────────────┘  └────────────────┘   │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Orchestration Platform: Kubernetes

### Why Kubernetes

The founder has 8 years of Kubernetes experience. This eliminates the operational complexity argument that favours simpler platforms. With K8s expertise in-house, Kubernetes offers:

| Advantage                     | Detail                                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| **Zero vendor lock-in**       | Manifests run on EKS, GKE, bare metal, or any CNCF-conformant cluster  |
| **Finest-grained control**    | Per-tenant network policies, pod security standards                    |
| **KEDA for scale-to-zero**    | Event-driven autoscaling; HTTP add-on for request-based scaling        |
| **cert-manager**              | Automated TLS for wildcard + custom domains via Let's Encrypt          |
| **Namespace isolation**       | Each tenant gets its own namespace with RBAC and network policies      |
| **Mature ecosystem**          | CloudNativePG, PgBouncer, external-dns, Prometheus, Grafana, Loki      |
| **Programmatic provisioning** | `@kubernetes/client-node` TypeScript SDK for full lifecycle management |
| **Multi-cloud portable**      | Start on one cloud, move to another without rewriting provisioning     |

### Managed vs Self-Managed

**Recommendation: Managed Kubernetes (EKS or GKE) to start.**

The founder's K8s expertise reduces risk, but managing the control plane, etcd, and node OS patches is still toil that doesn't build product. EKS/GKE handles that for ~$75/mo (EKS) or $0 (GKE Autopilot with per-pod billing).

| Option                            | Monthly Fixed Cost   | Best For                                            |
| --------------------------------- | -------------------- | --------------------------------------------------- |
| GKE Autopilot                     | $0 (per-pod billing) | Lowest starting cost, Google manages nodes          |
| GKE Standard                      | $75/mo + nodes       | Full control over node pools                        |
| EKS + Karpenter                   | $75/mo + nodes       | AWS ecosystem, Karpenter for efficient node scaling |
| Self-managed (kubeadm) on Hetzner | ~$20/mo per node     | Cheapest at scale, most ops burden                  |

**Starting recommendation: GKE Autopilot** for zero node management overhead, then evaluate GKE Standard or Hetzner bare-metal as costs justify.

### Cluster Architecture

```
Kubernetes Cluster
│
├── Namespace: qb-control-plane
│   ├── Deployment: control-plane (2-3 replicas, HPA)
│   ├── Service: control-plane (ClusterIP)
│   └── Ingress: quackback.io, auth.quackback.io, mcp.quackback.io
│
├── Namespace: qb-infra
│   ├── StatefulSet: postgres (CloudNativePG cluster, 3 replicas)
│   ├── Deployment: pgbouncer (2 replicas)
│   ├── StatefulSet: dragonfly (1-2 replicas)
│   ├── CronJob: pg-backup (daily pg_dump to S3)
│   └── ServiceMonitor: postgres-metrics, dragonfly-metrics
│
├── Namespace: keda
│   └── KEDA operator + HTTP add-on
│
├── Namespace: cert-manager
│   └── cert-manager + ClusterIssuer (Let's Encrypt)
│
├── Namespace: ingress-nginx
│   └── nginx ingress controller (or Traefik)
│
├── Namespace: monitoring
│   ├── Prometheus + Grafana
│   └── Loki (log aggregation)
│
├── Namespace: qb-t-acme          ← One per tenant
│   ├── Deployment: quackback (1 replica, KEDA-managed)
│   ├── Service: quackback (ClusterIP)
│   ├── ScaledObject: http-scaler (KEDA HTTP add-on)
│   └── NetworkPolicy: deny-all-except-ingress-and-infra
│
├── Namespace: qb-t-beta
│   └── (same pattern)
│
└── Namespace: qb-t-{slug}
    └── (same pattern)
```

### Per-Tenant Kubernetes Resources

Each tenant gets a dedicated namespace with these resources:

```yaml
# Namespace
apiVersion: v1
kind: Namespace
metadata:
  name: qb-t-{slug}
  labels:
    app.kubernetes.io/part-of: quackback-cloud
    quackback.io/tenant: '{slug}'
    quackback.io/plan: 'free'
---
# Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: quackback
  namespace: qb-t-{slug}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: quackback
  template:
    metadata:
      labels:
        app: quackback
        quackback.io/tenant: '{slug}'
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: quackback
          image: ghcr.io/quackbackio/quackback:{version}
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: tenant-secrets
          env:
            - name: BASE_URL
              value: 'https://{slug}.quackback.io'
            - name: CLOUD_MODE
              value: 'true'
            - name: REDIS_KEY_PREFIX
              value: 't:{slug}:'
            - name: S3_PATH_PREFIX
              value: 'tenants/{slug}/'
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 30
          lifecycle:
            preStop:
              exec:
                command: ['/bin/sh', '-c', 'sleep 5'] # Drain connections
---
# Service
apiVersion: v1
kind: Service
metadata:
  name: quackback
  namespace: qb-t-{slug}
spec:
  selector:
    app: quackback
  ports:
    - port: 3000
      targetPort: 3000
---
# Secret (created by control plane at provisioning time)
apiVersion: v1
kind: Secret
metadata:
  name: tenant-secrets
  namespace: qb-t-{slug}
type: Opaque
stringData:
  DATABASE_URL: 'postgresql://...@pgbouncer.qb-infra:6432/tenant_{slug}'
  SECRET_KEY: '{generated}'
  REDIS_URL: 'redis://dragonfly.qb-infra:6379'
  GATEWAY_INTERNAL_SECRET: '{shared-secret}'
---
# KEDA ScaledObject (scale to zero on no HTTP traffic)
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: http-scaler
  namespace: qb-t-{slug}
spec:
  scaleTargetRef:
    name: quackback
  minReplicaCount: 0 # Scale to zero!
  maxReplicaCount: 3
  cooldownPeriod: 300 # 5 min idle before scale-down
  triggers:
    - type: kubernetes-workload # Or KEDA HTTP add-on
      metadata:
        podSelector: 'app=quackback'
        value: '1'
---
# NetworkPolicy (deny all except ingress controller and infra namespace)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: tenant-isolation
  namespace: qb-t-{slug}
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              app.kubernetes.io/name: ingress-nginx
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: qb-control-plane
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: qb-infra
      ports:
        - port: 6432 # PgBouncer
        - port: 6379 # Dragonfly
    - to: # External (S3, email, webhooks, integrations)
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
```

### KEDA Scale-to-Zero

KEDA with the HTTP Add-on intercepts traffic at the ingress level:

1. When a tenant has zero pods, KEDA HTTP Add-on holds the request
2. KEDA spins up 1 pod for the tenant (cold start: ~5-10s for Bun container)
3. Request is forwarded once the pod is ready
4. After 5 minutes of no traffic, KEDA scales back to 0 pods

This is functionally equivalent to Fly.io's `auto_stop`/`auto_start` but with full control over the scaling parameters.

**BullMQ and scale-to-zero**: When a tenant pod is scaled to zero, BullMQ jobs remain queued in Redis. On wake, the pod reconnects and processes the queue. For paid tenants that need prompt background job processing, set `minReplicaCount: 1` (always on). For free tier, jobs wait until the next HTTP request wakes the pod.

### PostgreSQL with PgBouncer

Each Bun process opens `max: 50` connections. At 1000 tenants = 50,000 connections, far exceeding Postgres limits.

**Solution**: PgBouncer in transaction mode between tenant pods and Postgres.

```
Tenant Pod → PgBouncer (qb-infra, port 6432) → PostgreSQL Cluster
```

- PgBouncer pool: `default_pool_size=20`, `max_client_conn=10000`
- Tenant `DATABASE_URL` points to PgBouncer, not Postgres directly
- Cloud tenant instances use `prepare: false` (injected via `DB_PREPARE=false` env var) for PgBouncer transaction mode compatibility
- The OSS `createDb()` factory already accepts `{ prepare: boolean }` - just wire the env var

**PostgreSQL options**:

- **CloudNativePG** operator (recommended): Declarative Postgres clusters as K8s CRDs, automated failover, backup to S3, pgvector built-in
- **Amazon RDS**: Managed, supports pgvector on 15+. Higher cost but zero ops.

**pgvector provisioning**: The `db-provisioner.ts` must explicitly run `CREATE EXTENSION IF NOT EXISTS vector` before calling `runMigrations()`, since the programmatic `migrate-runtime.ts` omits this step.

---

## 4. Tenant Isolation Model

### Per-Tenant Resources

| Resource          | Isolation Strategy                    | How                                                                    |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| **Compute**       | Dedicated K8s namespace + pod         | KEDA scale-to-zero capable                                             |
| **Database**      | Separate Postgres database per tenant | `CREATE DATABASE tenant_{slug}` on shared cluster via PgBouncer        |
| **Redis**         | Key-prefix on shared Dragonfly        | `REDIS_KEY_PREFIX=t:{slug}:` env var                                   |
| **S3 storage**    | Path-prefix on shared bucket          | `S3_PATH_PREFIX=tenants/{slug}/` env var                               |
| **Secrets**       | K8s Secret per namespace              | `SECRET_KEY`, `DATABASE_URL` unique per tenant                         |
| **Network**       | NetworkPolicy per namespace           | Tenant pods can only reach PgBouncer, Dragonfly, and external internet |
| **DNS**           | `{slug}.quackback.io` subdomain       | Wildcard Ingress + cert-manager                                        |
| **Custom domain** | `feedback.acme.com` CNAME             | Per-domain Ingress + Certificate CRD                                   |

### Security: Shared Gateway Secret

For launch, all tenants share a single `GATEWAY_INTERNAL_SECRET`. NetworkPolicy already prevents tenant-to-tenant communication - the only attack vector would be env var exfiltration, at which point the attacker also has `DATABASE_URL` and `SECRET_KEY` for that tenant anyway.

**Future hardening** (pre-1000 tenants or security audit): Switch to per-tenant derived secrets using HMAC key derivation:

```typescript
function deriveTenantSecret(masterKey: string, tenantId: string): string {
  return createHmac('sha256', masterKey).update(`quackback-gateway:${tenantId}`).digest('hex')
}
```

---

## 5. Control Plane Application

### Technology Stack

| Component      | Technology                                                | Rationale                                           |
| -------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Runtime        | Bun                                                       | Same as OSS, team familiarity                       |
| Framework      | Hono                                                      | Lightweight, fast, ideal for proxy/gateway          |
| ORM            | Drizzle                                                   | Same as OSS, shared patterns                        |
| Database       | PostgreSQL (on shared cluster, database: `control_plane`) | Via PgBouncer                                       |
| Queue          | BullMQ + Dragonfly                                        | Same as OSS, for provisioning jobs                  |
| Auth (central) | Custom OAuth 2.1 AS with `jose`                           | Full control over authorization flow                |
| Billing        | Stripe SDK                                                | Checkout, webhooks, billing portal                  |
| K8s client     | `@kubernetes/client-node`                                 | Programmatic namespace/deployment/secret management |
| JWT            | `jose` (RS256 for central tokens)                         | Already a transitive dependency                     |

### Directory Structure

```
apps/control-plane/
├── src/
│   ├── index.ts                          # Hono app entrypoint
│   ├── config.ts                         # Zod-validated env config
│   ├── db/
│   │   ├── client.ts                     # Drizzle client (control_plane database)
│   │   ├── schema/
│   │   │   ├── accounts.ts              # Cloud user accounts (includes billing fields)
│   │   │   ├── tenants.ts              # Workspace instances
│   │   │   ├── domains.ts             # Custom domain records
│   │   │   └── oauth.ts               # Central OAuth clients, tokens, consents
│   │   └── migrations/
│   ├── services/
│   │   ├── provisioning.service.ts      # Create/suspend/resume/delete tenant
│   │   ├── billing.service.ts           # Stripe integration
│   │   ├── domain.service.ts            # Custom domain + TLS lifecycle
│   │   ├── k8s.service.ts              # Kubernetes API abstraction
│   │   └── db-provisioner.ts            # CREATE DATABASE + extensions + migrations
│   ├── routes/
│   │   ├── api/
│   │   │   ├── signup.ts               # Account creation
│   │   │   ├── workspaces.ts           # CRUD workspace lifecycle
│   │   │   ├── billing.ts             # Checkout, portal links
│   │   │   ├── domains.ts             # Custom domain management
│   │   │   └── webhooks/
│   │   │       └── stripe.ts          # Stripe webhook handler
│   │   ├── oauth/
│   │   │   ├── authorize.ts           # Authorization endpoint + login UI
│   │   │   ├── token.ts               # Token endpoint (code exchange + refresh)
│   │   │   ├── consent.ts             # Consent page
│   │   │   ├── revoke.ts              # Token revocation (RFC 7009)
│   │   │   └── well-known.ts          # Discovery documents
│   │   ├── mcp/
│   │   │   └── proxy.ts               # MCP request proxy + delegation JWT
│   │   └── proxy/
│   │       └── tenant.ts              # Host → instance reverse proxy
│   ├── jobs/
│   │   └── cleanup.ts                  # Delete long-suspended tenants
│   └── lib/
│       ├── errors.ts                    # Typed exceptions (mirrors OSS pattern)
│       ├── jwt.ts                       # RS256/HS256 token sign/verify
│       ├── stripe.ts                    # Stripe SDK singleton
│       └── tenant-resolver.ts           # Host → tenant lookup (Redis cached)
├── k8s/
│   ├── templates/                        # Tenant resource templates
│   │   ├── namespace.yaml
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── scaled-object.yaml
│   │   └── network-policy.yaml
│   └── base/                             # Control plane + infra manifests
│       ├── control-plane.yaml
│       ├── postgres.yaml
│       ├── pgbouncer.yaml
│       ├── dragonfly.yaml
│       └── keda.yaml
├── ui/                                   # Vite SPA: signup, billing dashboard
├── Dockerfile
├── package.json
└── tsconfig.json
```

### Control Plane Database Schema (Drizzle)

All schemas use Drizzle TypeScript (matching OSS conventions), not raw SQL.

**New TypeID prefixes** to register in `@quackback/ids`:

```
cloud_account, tenant, tenant_domain,
oauth_client_cloud, auth_code, refresh_tok, consent_cloud
```

Note: `account` and `domain` already exist in `@quackback/ids` for better-auth. We use `cloud_account` and `tenant_domain` to avoid collisions.

#### `accounts.ts`

Billing fields live directly on the account (1 account = 1 workspace = 1 subscription for v1).

```typescript
export const cloudAccounts = pgTable(
  'cloud_accounts',
  {
    id: typeIdWithDefault('cloud_account')('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'), // argon2id
    emailVerified: boolean('email_verified').default(false).notNull(),

    // Stripe billing (inline, no separate table for v1)
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionStatus: text('stripe_subscription_status'),
    plan: text('plan', {
      enum: ['free', 'pro', 'enterprise'],
    })
      .notNull()
      .default('free'),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('cloud_accounts_email_idx').on(t.email),
    index('cloud_accounts_stripe_idx').on(t.stripeCustomerId),
  ]
)
```

#### `tenants.ts`

```typescript
export const tenants = pgTable(
  'tenants',
  {
    id: typeIdWithDefault('tenant')('id').primaryKey(),
    accountId: typeIdColumn('cloud_account')('account_id')
      .notNull()
      .references(() => cloudAccounts.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['provisioning', 'active', 'suspended', 'deleting', 'deleted', 'error'],
    })
      .notNull()
      .default('provisioning'),
    plan: text('plan', {
      enum: ['free', 'pro', 'enterprise'],
    })
      .notNull()
      .default('free'),

    // Kubernetes
    namespace: text('namespace').notNull(), // "qb-t-acme"
    clusterServiceUrl: text('cluster_service_url'), // "http://quackback.qb-t-acme:3000"
    currentImageTag: text('current_image_tag'),

    // Database
    databaseName: text('database_name').notNull(), // "tenant_acme"

    // Provisioning state machine (for idempotent retry)
    provisioningStep: text('provisioning_step'), // last completed step
    provisioningError: text('provisioning_error'),

    // Timestamps
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    index('tenants_account_id_idx').on(t.accountId),
    index('tenants_status_idx').on(t.status),
  ]
)
```

#### `domains.ts`

```typescript
export const customDomains = pgTable(
  'custom_domains',
  {
    id: typeIdWithDefault('tenant_domain')('id').primaryKey(),
    tenantId: typeIdColumn('tenant')('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    verificationStatus: text('verification_status', {
      enum: ['pending', 'verified', 'failed'],
    })
      .notNull()
      .default('pending'),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    tlsStatus: text('tls_status', {
      enum: ['pending', 'provisioning', 'active', 'failed'],
    })
      .notNull()
      .default('pending'),
    certExpiresAt: timestamp('cert_expires_at', { withTimezone: true }),
    active: boolean('active').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('custom_domains_domain_idx').on(t.domain),
    index('custom_domains_tenant_id_idx').on(t.tenantId),
  ]
)
```

#### `oauth.ts`

Simplified: no dynamic client registration table (clients are manually registered), no workspace selection (1 account = 1 workspace), simple refresh tokens with expiry (no rotation/family tracking for v1).

```typescript
export const centralOAuthClients = pgTable('central_oauth_clients', {
  id: typeIdWithDefault('oauth_client_cloud')('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  name: text('name'),
  redirectUris: text('redirect_uris').array().notNull(),
  grantTypes: text('grant_types').array().notNull(),
  scopes: text('scopes').array(),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').default('none'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
})

export const authorizationCodes = pgTable(
  'authorization_codes',
  {
    id: typeIdWithDefault('auth_code')('id').primaryKey(),
    code: text('code').notNull().unique(),
    clientId: text('client_id').notNull(),
    userId: text('user_id').notNull(), // cloud_account.id
    tenantId: text('tenant_id').notNull(), // resolved from account (1:1 for v1)
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes').array().notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('auth_code_code_idx').on(t.code)]
)

export const centralRefreshTokens = pgTable(
  'central_refresh_tokens',
  {
    id: typeIdWithDefault('refresh_tok')('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPrefix: text('token_prefix').notNull(),
    clientId: text('client_id').notNull(),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // 30 days
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('refresh_token_prefix_idx').on(t.tokenPrefix),
    index('refresh_token_user_idx').on(t.userId),
  ]
)

export const centralConsents = pgTable(
  'central_consents',
  {
    id: typeIdWithDefault('consent_cloud')('id').primaryKey(),
    userId: text('user_id').notNull(),
    clientId: text('client_id').notNull(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('consent_user_client').on(t.userId, t.clientId)]
)
```

---

## 6. Provisioning Flow (Idempotent Saga)

Provisioning is idempotent with step-by-step checkpointing so retries don't fail on "database already exists." State is tracked on the `tenants` row directly (no separate provisioning jobs table).

### Step-by-Step

```
Provisioning Saga (each step checks precondition before executing):

Step 1: CREATE DATABASE
  Check: SELECT datname FROM pg_database WHERE datname = 'tenant_{slug}'
  Skip if exists.
  Execute: CREATE DATABASE tenant_{slug}
  Then: CREATE EXTENSION IF NOT EXISTS vector   ← pgvector required
  Then: runMigrations(tenantConnectionString)
  Save: tenant.provisioning_step = 'database_created'

Step 2: CREATE K8S NAMESPACE
  Check: k8sApi.readNamespace('qb-t-{slug}') - skip if 200
  Execute: k8sApi.createNamespace(namespaceManifest)
  Save: tenant.provisioning_step = 'namespace_created'

Step 3: CREATE K8S SECRET
  Check: k8sApi.readNamespacedSecret('tenant-secrets', 'qb-t-{slug}')
  Execute: k8sApi.createNamespacedSecret(secretManifest)
  Contains: DATABASE_URL, SECRET_KEY, REDIS_URL, GATEWAY_INTERNAL_SECRET,
            REDIS_KEY_PREFIX, S3_PATH_PREFIX, BASE_URL, CLOUD_MODE, DB_PREPARE=false
  Save: tenant.provisioning_step = 'secrets_created'

Step 4: CREATE K8S DEPLOYMENT + SERVICE + SCALED_OBJECT + NETWORK_POLICY
  Check: k8sApi.readNamespacedDeployment('quackback', 'qb-t-{slug}')
  Execute: Apply all tenant resource templates
  Save: tenant.provisioning_step = 'deployment_created'

Step 5: WAIT FOR POD READY
  Poll: k8sApi.readNamespacedPod - check conditions: Ready=True
  Timeout: 90 seconds
  Save: tenant.provisioning_step = 'pod_ready'

Step 6: CLOUD-INIT
  POST http://quackback.qb-t-{slug}:3000/api/internal/cloud-init
  Headers: X-Internal-Hmac: HMAC(body, GATEWAY_INTERNAL_SECRET)
  Body: {
    name: "Acme Corp",
    slug: "acme",
    adminEmail: "alice@acme.com"
  }
  Instance creates settings with setupState:
    {
      version: 1,
      steps: { core: true, workspace: true, boards: true },
      completedAt: new Date().toISOString(),
      source: 'cloud'
    }
  Instance creates default statuses and a "General" board.
  Save: tenant.provisioning_step = 'cloud_init_done'

Step 7: FINALIZE
  Update tenant: status='active', cluster_service_url, provisioned_at
  Save: tenant.provisioning_step = 'complete'
```

### Provisioning Time Budget

| Step                                      | Expected Duration                     |
| ----------------------------------------- | ------------------------------------- |
| Create database + extensions + migrations | 5-10s                                 |
| Create K8s resources                      | 2-5s                                  |
| Pod scheduling + container start          | 10-30s (depends on node availability) |
| Cloud-init seed                           | 1-2s                                  |
| **Total**                                 | **~20-50 seconds**                    |

---

## 7. Tenant Routing

### Ingress Architecture

All tenant traffic enters through the shared nginx ingress controller:

```yaml
# Wildcard Ingress for all tenant subdomains
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tenant-wildcard
  namespace: qb-control-plane
  annotations:
    cert-manager.io/cluster-issuer: 'letsencrypt-prod'
    nginx.ingress.kubernetes.io/use-regex: 'true'
spec:
  tls:
    - hosts:
        - '*.quackback.io'
      secretName: wildcard-quackback-tls
  rules:
    - host: '*.quackback.io'
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: control-plane
                port:
                  number: 3000
```

The control plane's tenant router middleware handles the actual routing:

```
1. Extract host from request (Host header)
2. Look up tenant:
   - {slug}.quackback.io → query tenants WHERE slug = {slug}
   - feedback.acme.com   → query custom_domains WHERE domain = host AND active = true
3. Redis cache (60s TTL) on lookup result
4. If tenant.status != 'active':
   - 'provisioning' → 202 "Your workspace is being set up..."
   - 'suspended'    → 503 "This workspace is suspended."
   - 'deleted'      → 404
5. Proxy request to tenant.cluster_service_url
   (http://quackback.qb-t-{slug}:3000)
6. Return tenant response as-is
```

### Custom Domains

```
1. POST /api/workspaces/:id/domains { domain: "feedback.acme.com" }
   → Generate verification token
   → Return DNS TXT instructions

2. Customer adds DNS records:
   TXT  _quackback-verify.feedback.acme.com = qb-verify-{token}
   CNAME feedback.acme.com → acme.quackback.io

3. POST /api/workspaces/:id/domains/:domainId/verify
   → DNS lookup validates TXT record

4. Control plane creates Certificate CRD + Ingress for the custom domain:

   apiVersion: cert-manager.io/v1
   kind: Certificate
   metadata:
     name: feedback-acme-com
     namespace: qb-control-plane
   spec:
     secretName: feedback-acme-com-tls
     issuerRef:
       name: letsencrypt-prod
       kind: ClusterIssuer
     dnsNames:
     - feedback.acme.com

5. cert-manager provisions Let's Encrypt certificate automatically
```

---

## 8. Billing (Stripe)

The control plane owns all billing. Tenant instances have zero billing knowledge. Plan enforcement via pod lifecycle (scale to zero permanently for suspended tenants, delete namespace for cancelled tenants).

### Plan Tiers

| Feature          | Free                     | Pro ($49/mo)                     | Enterprise (custom) |
| ---------------- | ------------------------ | -------------------------------- | ------------------- |
| Scale-to-zero    | Yes (cold start on wake) | `minReplicaCount: 1` (always on) | Always on           |
| Custom domain    | No                       | Yes                              | Yes                 |
| MCP/OAuth access | Yes                      | Yes                              | Yes                 |
| Storage          | 100MB                    | 5GB                              | Custom              |

### Stripe Integration

- **Signup**: Create Stripe customer, start on free tier
- **Upgrade**: Stripe Checkout session, redirect to billing portal
- **Webhooks**: `checkout.session.completed` -> update `cloudAccounts.plan`, patch KEDA `minReplicaCount`. `customer.subscription.deleted` -> suspend tenant.
- **Billing portal**: Stripe's hosted portal for plan changes, payment methods, invoices

---

## 9. Central OAuth Gateway

The central OAuth server at `auth.quackback.io` implements OAuth 2.1 with PKCE. Simplified for v1: no workspace selection (1 account = 1 workspace), no dynamic client registration (manually register Claude/ChatGPT clients), simple refresh tokens with 30-day expiry.

### OAuth Flow (Simplified)

```
1. Client redirects to auth.quackback.io/oauth/authorize
   ?client_id=claude-mcp
   &redirect_uri=...
   &response_type=code
   &code_challenge=...
   &code_challenge_method=S256
   &scope=mcp:read mcp:write

2. User logs in (or is already authenticated)

3. Consent screen: "Claude wants to access your Quackback workspace"
   - Show requested scopes
   - Skip if consent already granted for this client+scopes

4. Redirect back with authorization code:
   redirect_uri?code=...&state=...

5. Client exchanges code for tokens at /oauth/token:
   POST auth.quackback.io/oauth/token
   { grant_type: "authorization_code", code, redirect_uri, code_verifier }
   → { access_token (RS256, 1hr), refresh_token (30-day), token_type, expires_in, scope }

6. Client uses access_token to call mcp.quackback.io
   → MCP proxy verifies RS256 signature via cached JWKS
   → Proxy determines tenant from token claims
   → Signs delegation JWT (HS256) and forwards to tenant instance
```

### Discovery Endpoints

```
GET auth.quackback.io/.well-known/openid-configuration
GET auth.quackback.io/.well-known/oauth-authorization-server
GET auth.quackback.io/oauth/jwks
```

### OAuth Clients (Manually Registered)

For launch, manually insert 2-3 client rows:

- `claude-mcp` - Claude MCP marketplace
- `chatgpt-plugin` - ChatGPT plugin
- (optional) `quackback-cli` - First-party CLI tool

No dynamic registration endpoint needed. Add RFC 7591 later if third-party integrations demand it.

---

## 10. MCP Proxy and Delegation JWT

### Flow

```
1. Claude sends MCP request to mcp.quackback.io
   Authorization: Bearer {central_access_token}

2. MCP proxy:
   a. Verify RS256 access token (cached JWKS from auth.quackback.io)
   b. Extract tenant_id from token claims
   c. Look up tenant cluster service URL
   d. Sign delegation JWT (HS256, 30s TTL):
      {
        sub: claims.sub,
        aud: tenant.baseUrl,
        iss: "quackback-gateway",
        workspace_id: claims.tenant_id,
        principal_id: claims.principal_id,
        scopes: claims.scope.split(' '),
        gateway: true,
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + 30
      }
   e. Forward request to tenant:
      POST http://quackback.qb-t-{slug}:3000/mcp
      Authorization: Bearer {delegation_jwt}

3. Tenant instance (OSS code, Change 3):
   a. Detect delegation JWT (gateway: true claim)
   b. Verify HS256 signature against GATEWAY_INTERNAL_SECRET
   c. Verify iss, aud (matches BASE_URL), exp
   d. Check JTI against Redis for replay protection
   e. Build McpAuthContext from claims
   f. Process MCP request normally
```

### Redis-Based JTI Replay Protection

```typescript
// Instance verifies JTI against Redis, not in-memory Map:
const jtiKey = `${REDIS_PREFIX}jti:${payload.jti}`
const exists = await redis.exists(jtiKey)
if (exists) throw new Error('JTI replay detected')
await redis.setex(jtiKey, 60, '1') // TTL: 60s (covers 30s JWT + clock skew)
```

### Delegation JWT TTL for Streaming

For SSE-mode MCP connections, the proxy refreshes the delegation JWT on each tool call within the session, not once at connection establishment.

---

## 11. Instance Lifecycle Management

### Suspend

```
1. Update tenant.status = 'suspended'
2. k8sApi.patchNamespacedDeployment: set replicas=0
3. Or: delete the KEDA ScaledObject so KEDA doesn't wake it
4. Tenant router returns 503
5. Revoke central OAuth tokens for this tenant
```

### Resume

```
1. Verify billing current
2. Re-create KEDA ScaledObject (or set replicas=1)
3. Wait for pod ready
4. Update tenant.status = 'active'
```

### Delete

```
1. Update tenant.status = 'deleting'
2. k8sApi.deleteNamespace('qb-t-{slug}')  ← deletes ALL resources in namespace
3. DROP DATABASE tenant_{slug}
4. S3: delete all objects under tenants/{slug}/ (async)
5. Update tenant.status = 'deleted'
```

### Rolling Image Updates

```
For each active tenant:
  k8sApi.patchNamespacedDeployment('quackback', 'qb-t-{slug}', {
    spec: { template: { spec: { containers: [{
      name: 'quackback',
      image: 'ghcr.io/quackbackio/quackback:{newTag}'
    }]}}}
  })
  → Kubernetes performs rolling update with readinessProbe checks
  → Old pod stays alive until new pod is Ready (zero-downtime)
  → Migrations run on new pod startup via entrypoint script
```

At scale (>100 tenants), add batching with delays between groups to avoid thundering herd on Postgres during migrations.

---

## 12. Minimal OSS Changes

Seven additive, env-var-gated changes. All completely inert in self-hosted mode.

### Change 1: Redis Key Prefix

**Files:** `apps/web/src/lib/server/events/process.ts`, `segment-scheduler.ts`

```typescript
// Prefix goes INSIDE the hashtag for correct slot routing
const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX ?? ''
const QUEUE_NAME = REDIS_PREFIX ? `{${REDIS_PREFIX}event-hooks}` : '{event-hooks}'
```

~4 lines changed across 2 files.

### Change 2: S3 Path Prefix

**File:** `apps/web/src/lib/server/storage/s3.ts`

Must wrap all key touchpoints, not just Put/Get/Delete:

```typescript
const S3_PATH_PREFIX = process.env.S3_PATH_PREFIX ?? ''

function prefixKey(key: string): string {
  return S3_PATH_PREFIX ? `${S3_PATH_PREFIX}${key}` : key
}

function stripPrefix(key: string): string {
  return S3_PATH_PREFIX && key.startsWith(S3_PATH_PREFIX) ? key.slice(S3_PATH_PREFIX.length) : key
}

// Apply prefixKey() in: PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
//   generatePresignedUploadUrl, buildPublicUrl
// Apply stripPrefix() in: /api/storage/:key proxy route (to avoid double-prefixing)
```

~25 lines changed across 2 files (s3.ts + storage route).

### Change 3: Gateway Delegation Auth Path in MCP Handler

**Files:** `apps/web/src/lib/server/mcp/handler.ts` + new `gateway-auth.ts`

```typescript
// gateway-auth.ts: verifyHmacJwt (HS256), JTI check via Redis

// handler.ts: new auth resolution path before existing OAuth path
async function resolveGatewayDelegationContext(token: string): Promise<McpAuthContext | null> {
  const gatewaySecret = config.gatewayInternalSecret
  if (!gatewaySecret) return null // Not a cloud instance, skip entirely

  const payload = verifyHmacJwt(token, gatewaySecret)
  if (!payload.gateway) return null

  // Verify iss, aud (must match BASE_URL), exp (30s window)
  // Check JTI against Redis for replay protection
  // Build McpAuthContext from claims
  // Re-read role from DB for admin/member principals
}
```

~80 lines: new `gateway-auth.ts` + ~15 lines in handler.ts.

### Change 4: Cloud-Init Internal Endpoint

**New file:** `apps/web/src/routes/api/internal/cloud-init.ts`

HMAC-protected. Only active when `CLOUD_MODE=true`.

```typescript
// POST /api/internal/cloud-init
// 1. Verify HMAC(body, GATEWAY_INTERNAL_SECRET) from X-Internal-Hmac header
// 2. Create settings row with complete setupState:
//    { version: 1, steps: { core: true, workspace: true, boards: true },
//      completedAt: new Date().toISOString(), source: 'cloud' }
// 3. Create default post statuses
// 4. Create a default "General" board
// 5. Store adminEmail in settings metadata for auto-promotion
```

~100 lines, 1 new file.

### Change 5: Admin Auto-Promotion Hook

**File:** `apps/web/src/lib/server/auth/index.ts` (databaseHooks)

The existing `user.create.after` hook always creates principals with `role: 'user'`. For cloud instances, the first user matching the admin email gets promoted:

```typescript
// In databaseHooks.user.create.after:
if (process.env.CLOUD_MODE === 'true') {
  const settings = await db.query.settings.findFirst()
  const metadata = settings?.metadata ? JSON.parse(settings.metadata) : null
  if (metadata?.cloudAdminEmail === user.email) {
    // Set role to 'admin' instead of 'user'
    await db.update(principal).set({ role: 'admin' }).where(eq(principal.userId, user.id))
    // Clear the cloudAdminEmail so it only fires once
    await db
      .update(settingsTable)
      .set({ metadata: JSON.stringify({ ...metadata, cloudAdminEmail: null }) })
      .where(eq(settingsTable.id, settings.id))
  }
}
```

~20 lines added to existing file.

### Change 6: New Config Env Vars

**File:** `apps/web/src/lib/server/config.ts`

```typescript
// Add to configSchema:
gatewayInternalSecret: z.string().optional(),
cloudMode: envBoolean,
redisKeyPrefix: z.string().optional(),
s3PathPrefix: z.string().optional(),
dbPrepare: envBoolean,   // false for PgBouncer compatibility

// Add to buildConfigFromEnv():
gatewayInternalSecret: env('GATEWAY_INTERNAL_SECRET'),
cloudMode: env('CLOUD_MODE'),
redisKeyPrefix: env('REDIS_KEY_PREFIX'),
s3PathPrefix: env('S3_PATH_PREFIX'),
dbPrepare: env('DB_PREPARE'),
```

~15 lines changed.

### Change 7: SIGTERM Graceful Shutdown

**Files:** `apps/web/src/lib/server/events/process.ts`, `segment-scheduler.ts`

BullMQ workers don't shut down gracefully on SIGTERM, causing job loss on scale-to-zero.

```typescript
// Register at module level:
process.on('SIGTERM', async () => {
  console.log('[worker] SIGTERM received, closing queues...')
  await closeQueue()
  await closeSegmentScheduler()
  process.exit(0)
})
```

~10 lines across 2 files.

### Summary of OSS Impact

| Change                    | Files               | Lines          | Self-Hosted Impact                         |
| ------------------------- | ------------------- | -------------- | ------------------------------------------ |
| Redis key prefix          | 2                   | ~4             | None (prefix empty)                        |
| S3 path prefix            | 2                   | ~25            | None (prefix empty)                        |
| Gateway delegation auth   | 2 (1 new)           | ~95            | None (env var not set)                     |
| Cloud-init endpoint       | 1 (new)             | ~100           | None (CLOUD_MODE not set)                  |
| Admin auto-promotion hook | 1                   | ~20            | None (CLOUD_MODE not set)                  |
| Config env vars           | 1                   | ~15            | None (all optional)                        |
| SIGTERM graceful shutdown | 2                   | ~10            | Positive (improves shutdown for all users) |
| **Total**                 | **8 files (2 new)** | **~269 lines** | **Zero negative**                          |

---

## 13. Security Considerations

### Tenant Isolation Verification

- **Database**: Each tenant has separate DB credentials. PgBouncer enforces per-user-per-database pools.
- **Redis**: All keys prefixed. Write integration test that scans Redis for unprefixed keys.
- **S3**: Bucket policy restricts per-prefix access (if using IAM roles per tenant) or validated at application level.
- **Network**: NetworkPolicy denies cross-namespace pod communication. Tenant pods cannot reach other tenant pods.
- **Delegation JWTs**: Shared secret + audience check. NetworkPolicy restricts internal endpoints to control plane namespace only.

### Rate Limiting

- Tenant router: 100 req/s per IP per tenant
- OAuth token endpoint: 10 req/min per client_id per IP
- MCP proxy: 60 req/min per central user per workspace
- Internal endpoints: HMAC-protected + NetworkPolicy restricts to control plane namespace only

---

## 14. Implementation Phases

### Phase 1: Infrastructure Foundation (Week 1-3)

- [ ] Set up managed K8s cluster (GKE Autopilot or EKS)
- [ ] Deploy nginx ingress controller + cert-manager with ClusterIssuer
- [ ] Deploy KEDA operator + HTTP add-on
- [ ] Deploy CloudNativePG Postgres cluster (or connect to managed RDS)
- [ ] Deploy PgBouncer in front of Postgres
- [ ] Deploy Dragonfly StatefulSet
- [ ] Configure wildcard TLS cert for `*.quackback.io`
- [ ] Create `apps/control-plane/` scaffold with Hono, Drizzle, Zod config
- [ ] Register new TypeID prefixes in `@quackback/ids`
- [ ] Implement control plane DB schema (all Drizzle tables above)
- [ ] Implement typed exception hierarchy (`apps/control-plane/src/lib/errors.ts`)
- [ ] Implement cloud_accounts auth (argon2id, JWT sessions)
- [ ] Deploy control plane to cluster

### Phase 2: Provisioning Core (Week 3-5)

- [ ] Implement `k8s.service.ts` (namespace/deployment/secret/service CRUD via `@kubernetes/client-node`)
- [ ] Implement `db-provisioner.ts` (CREATE DATABASE + CREATE EXTENSION vector + runMigrations)
- [ ] Implement provisioning saga with idempotent step checkpointing (on tenant row)
- [ ] Implement BullMQ provisioning worker
- [ ] Create K8s resource templates in `k8s/templates/`
- [ ] Implement OSS Changes 1+2 (Redis prefix, S3 prefix)
- [ ] Implement OSS Change 4 (cloud-init endpoint)
- [ ] Implement OSS Change 5 (admin auto-promotion hook)
- [ ] Implement OSS Change 7 (SIGTERM handler)
- [ ] End-to-end test: signup -> provision -> namespace created -> pod running -> admin accessible

### Phase 3: Tenant Routing + Billing (Week 5-7)

- [ ] Implement `tenant-resolver.ts` with Redis cache
- [ ] Implement tenant proxy middleware in Hono
- [ ] Implement suspension/provisioning placeholder pages
- [ ] Test subdomain routing end-to-end
- [ ] Integrate Stripe SDK, implement `billing.service.ts`
- [ ] Implement Stripe Checkout + webhook handler (fields on `cloudAccounts`)
- [ ] Wire billing status to tenant suspension/resumption
- [ ] Build billing dashboard UI

### Phase 4: Central OAuth + MCP Proxy (Week 7-10)

- [ ] Implement RSA key pair management and JWKS endpoint
- [ ] Implement OAuth discovery endpoints (`.well-known/*`)
- [ ] Implement authorization endpoint with login UI
- [ ] Implement consent page (skip workspace selection - 1:1 for v1)
- [ ] Implement token endpoint (auth code exchange + PKCE)
- [ ] Implement simple refresh tokens (30-day expiry, no rotation)
- [ ] Implement token revocation endpoint
- [ ] Manually register Claude + ChatGPT OAuth clients
- [ ] Implement MCP proxy with central token verification (cached JWKS)
- [ ] Implement delegation JWT signing (shared secret)
- [ ] Implement OSS Change 3 (gateway delegation auth in MCP handler)
- [ ] Implement OSS Change 6 (config env vars)
- [ ] Implement Redis-based JTI replay protection on instance
- [ ] Set up `mcp.quackback.io` Ingress
- [ ] End-to-end test: Claude connects -> consent -> MCP tool call

### Phase 5: Custom Domains + Polish (Week 10-12)

- [ ] Implement domain verification (DNS TXT challenge)
- [ ] Implement custom domain routing in tenant resolver
- [ ] Implement Certificate CRD + Ingress creation via K8s API
- [ ] Build domain management UI
- [ ] Implement rolling update (simple loop, no batching for v1)
- [ ] Implement tenant cleanup job (delete long-suspended tenants)
- [ ] Set up Prometheus + Grafana monitoring
- [ ] Backup management (CloudNativePG scheduled backups to S3)
- [ ] Load testing: provision 50 tenants, verify isolation
- [ ] Security audit: cross-tenant access testing

---

## 15. Cost Projections

### Per-Tenant Cost (GKE Autopilot)

GKE Autopilot bills per pod: $0.000017/vCPU-second + $0.000001863/GB-second.

| Component                    | Free Tier (idle, scaled to zero) | Pro Tier (always-on, 100m CPU / 256Mi) |
| ---------------------------- | -------------------------------- | -------------------------------------- |
| Compute (pod)                | $0                               | ~$5-8/mo                               |
| Postgres storage (amortized) | ~$0.10/mo                        | ~$0.10/mo                              |
| Redis (amortized)            | ~$0.01/mo                        | ~$0.01/mo                              |
| S3 storage                   | ~$0.02/GB/mo                     | ~$0.02/GB/mo                           |
| Egress (~1GB/tenant/mo)      | ~$0.12/mo                        | ~$0.12/mo                              |
| **Estimated per-tenant**     | **~$0.25/mo**                    | **~$5-9/mo**                           |

### Platform Cost at Scale

| Tenants | Infra Cost/mo | Revenue (at $49 Pro, 20% paid) | Gross Margin |
| ------- | ------------- | ------------------------------ | ------------ |
| 100     | $300-500      | $980                           | ~50-70%      |
| 1,000   | $1,500-3,000  | $9,800                         | ~70-85%      |
| 10,000  | $8,000-15,000 | $98,000                        | ~85-90%      |

Fixed costs:

- GKE Autopilot control plane: $0 (included)
- Postgres cluster (3-node HA): ~$100-200/mo
- PgBouncer: ~$10/mo
- Dragonfly: ~$20-40/mo
- Monitoring stack: ~$30-50/mo
- Control plane pods: ~$20-30/mo

---

## 16. Migration and Portability

### Self-Hosted to Cloud Migration

1. User exports data via existing `/api/export` endpoint
2. User signs up for cloud, provisions workspace
3. User imports via `/api/import` endpoint
4. Data format is identical (same schema, same TypeIDs)

### Cloud to Self-Hosted (Data Portability)

Same export/import flow in reverse. Cloud customers own their data.

### Cloud Provider Migration

Since all infrastructure is Kubernetes-native:

- **GKE -> EKS**: Export manifests, adjust StorageClass and Ingress annotations
- **GKE -> Hetzner bare metal**: kubeadm cluster, same manifests, change StorageClass
- Estimated effort: 1-2 engineering days for the migration, plus DNS propagation

---

## 17. Future Enhancements (Add When Needed)

These were considered for v1 but deferred. Add them when specific triggers occur:

| Enhancement                     | Trigger to Add                                  | Effort                                                                        |
| ------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| **Multi-workspace per account** | Customer requests >1 workspace                  | Add `workspaceMemberships` table, workspace selector in OAuth flow (~2 weeks) |
| **Per-tenant HMAC secrets**     | >1000 tenants or security audit                 | HMAC key derivation from master key (~1 week)                                 |
| **Refresh token rotation**      | Security audit or compliance requirement        | Family tracking, cascade revocation (~1 week)                                 |
| **Dynamic client registration** | Third-party integrations want OAuth access      | RFC 7591 endpoint + rate limiting (~1 week)                                   |
| **Health monitoring job**       | >100 paying tenants                             | BullMQ repeatable job polling pod health (~2 days)                            |
| **Queue tickler**               | Free-tier users complain about delayed webhooks | BullMQ job to wake scaled-to-zero pods with pending work (~2 days)            |
| **Rolling update batching**     | >100 tenants                                    | Batch deployments with delays to avoid migration thundering herd (~1 day)     |
| **ResourceQuota per namespace** | Noisy neighbor complaints                       | K8s quota CRDs per tenant namespace (~1 day)                                  |
| **CNAME re-verification**       | Custom domain abuse or cert exhaustion          | 24h cron to re-check CNAME records (~1 day)                                   |
| **Multi-region**                | Enterprise customers require data residency     | Regional node pools, Postgres read replicas (~4 weeks)                        |
| **SSO/SAML**                    | Enterprise plan requirement                     | Add to central auth server (~2 weeks)                                         |
| **Usage-based billing**         | Business model evolution                        | K8s metrics-server -> Stripe metered billing (~2 weeks)                       |
| **White-label**                 | Enterprise customers want custom branding       | Per-tenant portal config (~1 week)                                            |
| **Hetzner migration**           | Monthly infra exceeds ~$5k                      | Self-managed K8s on dedicated servers (~1-2 weeks)                            |

---

## 18. Open Questions

1. **Pricing**: Per-seat, flat tier, or hybrid?
2. **Free tier**: How generous? Time-limited trial or permanent free tier with scale-to-zero?
3. **Data residency**: EU/GDPR data residency -> regional node pools + regional Postgres?
4. **Cloud provider**: GKE Autopilot (recommended) vs EKS vs self-managed?
5. **Backups**: Per-tenant backup frequency? Self-service restore?
6. **Branding**: Control plane UI design - build custom or use existing design system?

---

## 19. What Was Simplified (and Why)

For reference, these decisions were made to reduce launch scope from ~16 weeks to ~12 weeks:

1. **Dropped `provisioningJobs` table**: Tenant row tracks `provisioningStep` + `provisioningError`. BullMQ handles retries. No need for a separate job-tracking table.

2. **Dropped `billingEvents` table**: Stripe retains all webhook events in their dashboard. Can replay from Stripe if needed for debugging.

3. **Inlined billing on `cloudAccounts`**: No separate `billingAccounts` table. For v1, 1 account = 1 subscription. Split when multi-workspace billing is needed.

4. **Dropped `workspaceMemberships` table**: 1 account = 1 workspace for v1. Eliminates workspace selector page in OAuth flow. The `tenants` table has `accountId` for the 1:1 relationship.

5. **No dynamic client registration**: Manually register 2-3 OAuth clients (Claude, ChatGPT). No RFC 7591 endpoint until third parties need it.

6. **Simple refresh tokens**: 30-day expiry, no rotation, no family tracking. Still secure (tokens are hashed, revocable). Add rotation for compliance.

7. **No health monitor job**: K8s liveness/readiness probes handle pod health. Prometheus + kube-state-metrics provides visibility. Add custom monitoring at >100 paid tenants.

8. **No queue tickler**: Paid tenants get `minReplicaCount: 1` (always on). Free-tier background jobs wait for next HTTP request to wake the pod.

9. **No rolling update batching**: Update all deployments directly. K8s handles per-deployment rollout with readiness gates. Add batching at >100 tenants.

10. **No ResourceQuota per namespace**: Pod `resources.limits` caps individual pods. Only the control plane has RBAC to create pods in tenant namespaces. Add quotas if noisy neighbor becomes an issue.

11. **Shared gateway secret**: NetworkPolicy prevents cross-tenant communication. Shared secret + audience check is sufficient for launch. Add per-tenant HMAC derivation pre-1000 tenants.

12. **No CNAME re-verification**: cert-manager handles renewal. Stale CNAMEs self-correct (cert renewal fails, customer notices). Add periodic verification when custom domains are popular.
