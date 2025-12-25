# Integration/Plugin Architecture for Quackback

## Overview

This document outlines the recommended plugin/integration interface for Quackback, a unified system supporting first-party integrations, webhooks, and third-party apps.

## Architecture Layers

### Layer 1: Integration Manifest System

**Purpose**: Declarative configuration for all integrations

**Location**: `packages/integrations/src/base/manifest.ts`

```typescript
import { z } from 'zod'
import type { DomainEventType } from './integration'

export interface IntegrationManifest {
  // Metadata
  id: string                    // e.g., 'slack', 'github', 'webhook'
  name: string                  // Display name
  description: string
  version: string               // Semver
  category: 'communication' | 'issue-tracking' | 'analytics' | 'automation' | 'custom'
  tier: 'first-party' | 'webhook' | 'third-party'

  // Capabilities
  supportedEvents: DomainEventType[]

  // Authentication
  auth: {
    method: 'oauth2' | 'api_key' | 'webhook_secret'
    oauth?: {
      authorizationUrl: string
      tokenUrl: string
      scopes: Array<{ id: string; name: string; description: string }>
      pkceRequired: boolean
    }
  }

  // Actions (what the integration can do)
  actions: Array<{
    id: string
    name: string
    description: string
    triggerEvents: DomainEventType[]
    configSchema: z.ZodSchema      // Type-safe config validation
  }>

  // Rate limits
  rateLimits?: {
    requestsPerMinute: number
    requestsPerHour: number
  }

  // Features
  features: {
    supportsTestConnection: boolean
    supportsBidirectionalSync: boolean
  }
}
```

**Example Implementations**:

```typescript
// Slack (Tier 1: First-Party)
export const slackManifest: IntegrationManifest = {
  id: 'slack',
  name: 'Slack',
  description: 'Post feedback updates to Slack channels',
  version: '1.0.0',
  category: 'communication',
  tier: 'first-party',
  supportedEvents: ['post.created', 'post.status_changed', 'comment.created'],

  auth: {
    method: 'oauth2',
    oauth: {
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: [
        { id: 'channels:read', name: 'View channels', description: 'View basic channel info' },
        { id: 'chat:write', name: 'Send messages', description: 'Post messages to channels' },
      ],
      pkceRequired: false,
    },
  },

  actions: [
    {
      id: 'post-to-channel',
      name: 'Post to Channel',
      description: 'Send a message to a Slack channel when events occur',
      triggerEvents: ['post.created', 'post.status_changed'],
      configSchema: z.object({
        channelId: z.string().min(1),
        messageTemplate: z.string().optional(),
      }),
    },
  ],

  rateLimits: {
    requestsPerMinute: 60,
    requestsPerHour: 3000,
  },

  features: {
    supportsTestConnection: true,
    supportsBidirectionalSync: false,
  },
}

// Webhook (Tier 2: User-Configured)
export const webhookManifest: IntegrationManifest = {
  id: 'webhook',
  name: 'Custom Webhook',
  description: 'Send HTTP POST requests to your endpoint',
  version: '1.0.0',
  category: 'custom',
  tier: 'webhook',
  supportedEvents: [
    'post.created',
    'post.updated',
    'post.status_changed',
    'comment.created',
    'vote.created',
    'changelog.published',
  ],

  auth: {
    method: 'webhook_secret',
  },

  actions: [
    {
      id: 'send-webhook',
      name: 'Send Webhook',
      description: 'POST event data to your endpoint',
      triggerEvents: ['*'], // All events
      configSchema: z.object({
        url: z.string().url(),
        secret: z.string().min(32), // HMAC signing secret
        headers: z.record(z.string()).optional(),
      }),
    },
  ],

  rateLimits: {
    requestsPerMinute: 120,
    requestsPerHour: 5000,
  },

  features: {
    supportsTestConnection: true,
    supportsBidirectionalSync: false,
  },
}
```

### Layer 2: Webhook Delivery System

**Purpose**: Reliable outbound webhook delivery with retries

**Location**: `packages/integrations/src/base/webhook-delivery.ts`

```typescript
import { createHmac } from 'crypto'
import type { DomainEvent } from './integration'
import type { CircuitBreaker } from './circuit-breaker'

export interface WebhookDelivery {
  id: string
  integrationId: string
  event: DomainEvent
  endpoint: string
  secret: string
  attempt: number
  maxAttempts: number
  status: 'pending' | 'delivering' | 'success' | 'failed' | 'dead'
}

export class WebhookDeliveryService {
  constructor(
    private readonly circuitBreaker: CircuitBreaker,
    private readonly redis: Redis
  ) {}

  async deliver(delivery: WebhookDelivery): Promise<{ success: boolean; error?: string }> {
    // Check circuit breaker
    if (!await this.circuitBreaker.canExecute()) {
      return { success: false, error: 'Circuit breaker open' }
    }

    // Check idempotency
    const cacheKey = `webhook:delivered:${delivery.event.id}:${delivery.integrationId}`
    const alreadyDelivered = await this.redis.get(cacheKey)
    if (alreadyDelivered) {
      return { success: true }
    }

    try {
      // Sign payload
      const payload = JSON.stringify(delivery.event)
      const signature = this.signPayload(payload, delivery.secret)

      // Deliver with timeout
      const response = await fetch(delivery.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Quackback-Signature': signature,
          'X-Quackback-Event-Type': delivery.event.type,
          'X-Quackback-Event-Id': delivery.event.id,
          'X-Quackback-Delivery-Id': delivery.id,
          'User-Agent': 'Quackback-Webhooks/1.0',
        },
        body: payload,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Success
      await this.circuitBreaker.recordSuccess()
      await this.redis.setex(cacheKey, 604800, '1') // 7 days TTL

      return { success: true }

    } catch (error) {
      await this.circuitBreaker.recordFailure()

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
  }

  calculateBackoff(attempt: number): number {
    // Exponential backoff: 5s, 25s, 125s, 625s (5^n seconds)
    const baseMs = 5000
    const backoff = baseMs * Math.pow(5, attempt)
    // Add jitter (±20%)
    const jitter = backoff * 0.2 * (Math.random() - 0.5)
    return Math.min(backoff + jitter, 600000) // Cap at 10 minutes
  }
}
```

**Database Schema Addition**:

```typescript
// packages/db/src/schema/integrations.ts

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: typeIdWithDefault('whook')('id').primaryKey(),
  integrationId: typeIdColumn('integration')('integration_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  endpoint: text('endpoint').notNull(),

  status: varchar('status', { length: 20 }).notNull().default('pending'),
  attempt: integer('attempt').notNull().default(1),
  maxAttempts: integer('max_attempts').notNull().default(5),

  requestBody: jsonb('request_body'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),

  deliveredAt: timestamp('delivered_at'),
  nextRetryAt: timestamp('next_retry_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

### Layer 3: API Key Authentication

**Purpose**: Secure external API access for third-party apps

**Location**: `packages/db/src/schema/api-keys.ts`

```typescript
export const apiKeys = pgTable('api_keys', {
  id: typeIdWithDefault('apikey')('id').primaryKey(),

  // Display name
  name: text('name').notNull(),

  // Key format: qb_live_xxxxxxxxxx (prefix for identification)
  keyPrefix: varchar('key_prefix', { length: 8 }).notNull(),

  // Store SHA-256 hash, not the actual key
  keyHashSha256: text('key_hash_sha256').notNull().unique(),

  // Owner
  memberId: typeIdColumn('member')('member_id').notNull(),

  // Permissions
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),

  // Usage tracking
  lastUsedAt: timestamp('last_used_at'),
  lastUsedIp: varchar('last_used_ip', { length: 45 }),
  requestCount: integer('request_count').notNull().default(0),

  // Lifecycle
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  revokedReason: text('revoked_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const apiKeyScopes = [
  'posts:read',
  'posts:write',
  'boards:read',
  'boards:write',
  'comments:read',
  'comments:write',
  'votes:read',
  'votes:write',
  'analytics:read',
  'webhooks:manage',
] as const

export type ApiKeyScope = typeof apiKeyScopes[number]
```

**API Key Service**:

```typescript
// packages/domain/src/api-keys/api-key.service.ts
import { createHash, randomBytes } from 'crypto'
import { ok, err, type Result } from '../shared/result'
import type { ApiKeyScope } from '@quackback/db'

export interface CreateApiKeyInput {
  name: string
  scopes: ApiKeyScope[]
  expiresInDays?: number
}

export interface ApiKeyResult {
  id: string
  name: string
  key: string  // Only returned once!
  prefix: string
  scopes: ApiKeyScope[]
  expiresAt: Date | null
  createdAt: Date
}

export class ApiKeyService {
  async createApiKey(
    input: CreateApiKeyInput,
    ctx: ServiceContext
  ): Promise<Result<ApiKeyResult, ApiKeyError>> {
    return withUnitOfWork(async (uow) => {
      // Generate key: qb_live_ + 32 random bytes (base62 encoded)
      const prefix = 'qb_live_'
      const randomPart = randomBytes(32).toString('base64url').slice(0, 40)
      const fullKey = `${prefix}${randomPart}`

      // Hash for storage
      const keyHash = createHash('sha256').update(fullKey).digest('hex')

      // Calculate expiration
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null

      // Create record
      const [apiKey] = await uow.db.insert(apiKeys).values({
        name: input.name,
        keyPrefix: prefix.slice(0, 8),
        keyHashSha256: keyHash,
        memberId: ctx.memberId,
        scopes: input.scopes,
        expiresAt,
      }).returning()

      return ok({
        id: apiKey.id,
        name: apiKey.name,
        key: fullKey,  // ONLY returned here!
        prefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
      })
    })
  }

  async validateApiKey(
    key: string
  ): Promise<Result<{ memberId: string; scopes: ApiKeyScope[] }, ApiKeyError>> {
    return withUnitOfWork(async (uow) => {
      // Hash the provided key
      const keyHash = createHash('sha256').update(key).digest('hex')

      // Look up by hash
      const [apiKey] = await uow.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.keyHashSha256, keyHash),
            isNull(apiKeys.revokedAt),
            or(
              isNull(apiKeys.expiresAt),
              gt(apiKeys.expiresAt, new Date())
            )
          )
        )

      if (!apiKey) {
        return err(ApiKeyError.invalid())
      }

      // Update last used
      await uow.db
        .update(apiKeys)
        .set({
          lastUsedAt: new Date(),
          requestCount: apiKey.requestCount + 1,
        })
        .where(eq(apiKeys.id, apiKey.id))

      return ok({
        memberId: apiKey.memberId,
        scopes: apiKey.scopes,
      })
    })
  }
}
```

### Layer 4: Extended API Handler (Supporting API Keys)

**Location**: `apps/web/lib/api-handler.ts`

```typescript
export interface ApiHandlerOptions {
  roles?: string[]
  feature?: Feature
  allowApiKey?: boolean  // NEW: Allow API key auth
  requireScopes?: ApiKeyScope[]  // NEW: Required scopes for API key
}

export interface ApiValidation {
  authType: 'session' | 'api_key'
  user: { id: string; name: string | null; email: string }
  member: { id: string; role: string }
  scopes?: ApiKeyScope[]  // Available when authType === 'api_key'
}

export function withApiHandler(
  handler: (request: NextRequest, context: { validation: ApiValidation }) => Promise<NextResponse>,
  options: ApiHandlerOptions = {}
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      let validation: ApiValidation

      // Try API key auth first if allowed
      if (options.allowApiKey) {
        const authHeader = request.headers.get('authorization')
        if (authHeader?.startsWith('Bearer ')) {
          const apiKeyResult = await validateBearerToken(authHeader)

          if (apiKeyResult.success) {
            // Check required scopes
            if (options.requireScopes) {
              const hasAllScopes = options.requireScopes.every(
                scope => apiKeyResult.scopes.includes(scope)
              )
              if (!hasAllScopes) {
                return NextResponse.json(
                  { error: `Missing required scopes: ${options.requireScopes.join(', ')}` },
                  { status: 403 }
                )
              }
            }

            validation = {
              authType: 'api_key',
              user: apiKeyResult.user,
              member: apiKeyResult.member,
              scopes: apiKeyResult.scopes,
            }

            return handler(request, { validation })
          }
        }
      }

      // Fall back to session auth
      const sessionResult = await validateApiTenantAccess()
      if (!sessionResult.success) {
        return NextResponse.json(
          { error: sessionResult.error },
          { status: sessionResult.status }
        )
      }

      validation = {
        authType: 'session',
        user: sessionResult.user,
        member: sessionResult.member,
      }

      // Check role requirements
      if (options.roles && !requireRole(validation.member.role, options.roles)) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        )
      }

      // Check feature gate
      if (options.feature) {
        const hasFeature = checkFeatureAccess(sessionResult.settings, options.feature)
        if (!hasFeature) {
          return NextResponse.json(
            { error: `Feature ${options.feature} not available on your plan` },
            { status: 403 }
          )
        }
      }

      return handler(request, { validation })

    } catch (error) {
      console.error('API handler error:', error)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }
  }
}

async function validateBearerToken(authHeader: string): Promise<{
  success: boolean
  user: { id: string; name: string | null; email: string }
  member: { id: string; role: string }
  scopes: ApiKeyScope[]
}> {
  const token = authHeader.slice(7) // Remove 'Bearer '

  const result = await getApiKeyService().validateApiKey(token)

  if (!result.success) {
    return { success: false }
  }

  // Get member and user info
  const member = await getMemberById(result.value.memberId)
  if (!member) {
    return { success: false }
  }

  return {
    success: true,
    user: {
      id: member.userId,
      name: member.userName,
      email: member.userEmail,
    },
    member: {
      id: member.id,
      role: member.role,
    },
    scopes: result.value.scopes,
  }
}
```

### Layer 5: Public REST API

**Location**: `apps/web/app/api/v1/`

```typescript
// apps/web/app/api/v1/posts/route.ts

import { withApiHandler, successResponse } from '@/lib/api-handler'
import { getPostService } from '@quackback/domain'
import { buildServiceContext } from '@quackback/domain'

// GET /api/v1/posts?board=feature-requests&status=open
export const GET = withApiHandler(
  async (request, { validation }) => {
    const { searchParams } = new URL(request.url)
    const boardSlug = searchParams.get('board')
    const status = searchParams.get('status')

    const ctx = buildServiceContext(validation)
    const result = await getPostService().listPosts({
      boardSlug: boardSlug || undefined,
      statusFilter: status || undefined,
    }, ctx)

    if (!result.success) {
      throw new ApiError(result.error.message, 400)
    }

    return successResponse({
      posts: result.value.posts,
      pagination: result.value.pagination,
    })
  },
  {
    allowApiKey: true,
    requireScopes: ['posts:read']
  }
)

// POST /api/v1/posts
export const POST = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const input = validateBody(createPostSchema, body)

    const ctx = buildServiceContext(validation)
    const result = await getPostService().createPost(input, ctx)

    if (!result.success) {
      throw new ApiError(result.error.message, 400)
    }

    return successResponse(result.value, 201)
  },
  {
    allowApiKey: true,
    requireScopes: ['posts:write'],
    roles: ['owner', 'admin', 'member']
  }
)
```

### Layer 6: Hook Registry (Event Filters & Actions)

**Purpose**: Allow plugins to intercept and modify data flows

**Location**: `packages/integrations/src/base/hooks.ts`

```typescript
export type HookPriority = 'low' | 'normal' | 'high' | 'critical'

export type FilterHook<T> = (data: T, context: HookContext) => Promise<T>
export type ActionHook<T> = (data: T, context: HookContext) => Promise<void>

export interface HookContext {
  workspaceId: string
  userId?: string
  metadata: Record<string, unknown>
}

export class HookRegistry {
  private filters = new Map<string, Array<{ priority: HookPriority; handler: FilterHook<any> }>>()
  private actions = new Map<string, Array<{ priority: HookPriority; handler: ActionHook<any> }>>()

  // Register a filter (transforms data)
  addFilter<T>(
    hookName: string,
    handler: FilterHook<T>,
    priority: HookPriority = 'normal'
  ): void {
    if (!this.filters.has(hookName)) {
      this.filters.set(hookName, [])
    }
    this.filters.get(hookName)!.push({ priority, handler })
    this.sortByPriority(this.filters.get(hookName)!)
  }

  // Register an action (side effect)
  addAction<T>(
    hookName: string,
    handler: ActionHook<T>,
    priority: HookPriority = 'normal'
  ): void {
    if (!this.actions.has(hookName)) {
      this.actions.set(hookName, [])
    }
    this.actions.get(hookName)!.push({ priority, handler })
    this.sortByPriority(this.actions.get(hookName)!)
  }

  // Execute filters (transforms data through pipeline)
  async applyFilters<T>(
    hookName: string,
    data: T,
    context: HookContext
  ): Promise<T> {
    const hooks = this.filters.get(hookName) || []

    let result = data
    for (const { handler } of hooks) {
      result = await handler(result, context)
    }

    return result
  }

  // Execute actions (run side effects in parallel)
  async doActions<T>(
    hookName: string,
    data: T,
    context: HookContext
  ): Promise<void> {
    const hooks = this.actions.get(hookName) || []

    await Promise.all(
      hooks.map(({ handler }) => handler(data, context))
    )
  }

  private sortByPriority(hooks: Array<{ priority: HookPriority; handler: any }>): void {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 }
    hooks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }
}

// Global registry instance
export const hookRegistry = new HookRegistry()
```

**Usage in Services**:

```typescript
// In PostService.createPost()
async createPost(input: CreatePostInput, ctx: ServiceContext): Promise<Result<Post, PostError>> {
  return withUnitOfWork(async (uow) => {
    // Apply filters to transform input
    const filteredInput = await hookRegistry.applyFilters(
      'post.beforeCreate',
      input,
      { workspaceId: ctx.workspaceId, userId: ctx.userId }
    )

    // Create post
    const post = await postRepo.create(filteredInput)

    // Run actions (notifications, integrations, etc.)
    await hookRegistry.doActions(
      'post.afterCreate',
      post,
      { workspaceId: ctx.workspaceId, userId: ctx.userId }
    )

    return ok(post)
  })
}
```

**Example Plugin Using Hooks**:

```typescript
// Custom spam filter plugin
hookRegistry.addFilter(
  'post.beforeCreate',
  async (input, ctx) => {
    const isSpam = await checkSpam(input.content)
    if (isSpam) {
      throw new Error('Spam detected')
    }
    return input
  },
  'high' // Run before normal filters
)

// Custom analytics plugin
hookRegistry.addAction(
  'post.afterCreate',
  async (post, ctx) => {
    await analyticsService.track('post_created', {
      postId: post.id,
      userId: ctx.userId,
      timestamp: new Date(),
    })
  },
  'low' // Run after other actions
)
```

---

## 4. Migration Path

### Phase 1: Core Infrastructure (Weeks 1-2)

**Goal**: Add webhook delivery and API key auth

1. Create database migrations for:
   - `api_keys` table
   - `webhook_deliveries` table

2. Implement services:
   - `ApiKeyService` with create/validate/revoke methods
   - `WebhookDeliveryService` with retry logic

3. Extend `withApiHandler` to support bearer token auth

4. Add admin UI for managing:
   - API keys (create, view, revoke)
   - Webhook endpoints (configure URL, secret, events)

### Phase 2: Public API (Weeks 3-4)

**Goal**: Expose REST endpoints for external access

1. Create `/api/v1/*` route structure:
   - `/api/v1/posts` (GET, POST, PATCH, DELETE)
   - `/api/v1/comments` (GET, POST, DELETE)
   - `/api/v1/boards` (GET)
   - `/api/v1/votes` (POST, DELETE)

2. Add rate limiting per API key (using Redis)

3. Generate OpenAPI spec for documentation

4. Build developer portal at `/developers`:
   - API documentation
   - Interactive API explorer
   - Example code snippets

### Phase 3: Enhanced Integration System (Weeks 5-6)

**Goal**: Improve first-party integrations

1. Implement manifest system:
   - Create `IntegrationManifest` interface
   - Migrate Slack to use manifest
   - Add GitHub, Discord integrations

2. Build integration marketplace UI:
   - Browse available integrations
   - One-click installation
   - Configuration forms (auto-generated from Zod schemas)

3. Add hook registry:
   - Implement `HookRegistry` class
   - Integrate with service layer
   - Document available hooks

### Phase 4: Developer Platform (Weeks 7-8)

**Goal**: Enable third-party developers

1. Create developer onboarding flow:
   - Developer registration
   - App creation wizard
   - API key generation

2. Build app management dashboard:
   - View API usage metrics
   - Test webhook delivery
   - Rotate API keys

3. Write comprehensive documentation:
   - Getting started guide
   - API reference
   - Integration examples
   - Best practices

---

## 5. Security Considerations

### API Key Security

- Store SHA-256 hash, never plaintext
- Use prefixed keys for identification (`qb_live_`, `qb_test_`)
- Implement key rotation without downtime
- Auto-expire keys (recommend 90 days)
- Rate limit per key (100 req/min, 5000 req/hour)
- Log all API key usage for audit

### Webhook Security

- HMAC-SHA256 signature verification
- Validate endpoint URLs (no localhost, no internal IPs)
- Timeout requests at 10 seconds
- Implement replay protection (event ID caching)
- Respect HTTP 410 Gone (auto-disable webhook)

### OAuth Security

- Always use PKCE for authorization code flow
- Validate state parameter (HMAC-signed)
- Encrypt tokens at rest (AES-256-GCM)
- Implement token rotation
- Auto-revoke on suspicious activity

---

## 6. Monitoring & Observability

### Metrics to Track

```typescript
export interface IntegrationMetrics {
  // Delivery
  deliverySuccessRate: number
  p50Latency: number
  p95Latency: number
  p99Latency: number

  // Queue
  queueDepth: number
  timeToDrain: number

  // Errors
  errorRate: number
  errorsByType: Record<string, number>

  // Circuit breaker
  circuitState: 'open' | 'closed' | 'half-open'
}
```

### Admin Dashboard

Display in `/admin/integrations/analytics`:

- Real-time delivery status
- Error rates by integration
- Webhook retry queue depth
- API key usage charts
- Most active integrations

---

## 7. Example Usage Scenarios

### Scenario 1: User Configures Slack Notifications

1. User clicks "Connect Slack" in admin settings
2. OAuth flow: Redirect to Slack → User authorizes → Callback saves encrypted token
3. User configures event mapping:
   - Event: `post.created`
   - Action: `post-to-channel`
   - Config: `{ channelId: "C123ABC" }`
4. System creates `integrationEventMappings` record
5. When post is created:
   - Event job queued
   - Integration processor loads mapping
   - Calls `SlackIntegration.processEvent()`
   - Message posted to Slack
   - Delivery logged in `integrationSyncLog`

### Scenario 2: User Sets Up Custom Webhook

1. User navigates to `/admin/integrations/webhooks`
2. Clicks "Add Webhook"
3. Configures:
   - URL: `https://example.com/quackback-webhook`
   - Secret: `sk_live_...` (generated)
   - Events: `post.created`, `post.status_changed`
4. System creates integration with type `webhook`
5. When event occurs:
   - `WebhookDeliveryService` sends POST request
   - Signs payload with HMAC-SHA256
   - Includes headers: `X-Quackback-Signature`, `X-Quackback-Event-Type`
   - Retries on failure with exponential backoff
   - User's endpoint validates signature and processes event

### Scenario 3: Developer Builds Third-Party App

1. Developer registers at `/developers`
2. Creates new app: "Quackback Analytics Dashboard"
3. Generates API key with scopes: `posts:read`, `comments:read`, `analytics:read`
4. Receives key: `qb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (shown once)
5. Developer makes API calls:

```bash
curl -H "Authorization: Bearer qb_live_xxx" \
  https://quackback.io/api/v1/posts?board=feature-requests
```

6. System validates key, checks scopes, returns data
7. Developer builds custom analytics dashboard using API data

---

## 8. Testing Strategy

### Unit Tests

```typescript
// Test webhook signature verification
test('verifyWebhookSignature validates correct signature', () => {
  const payload = JSON.stringify({ event: 'post.created' })
  const secret = 'sk_test_123'
  const signature = createHmac('sha256', secret).update(payload).digest('hex')

  expect(verifyWebhookSignature(payload, signature, secret)).toBe(true)
})

// Test API key validation
test('validateApiKey rejects expired key', async () => {
  const expiredKey = await createExpiredApiKey()
  const result = await apiKeyService.validateApiKey(expiredKey.key)

  expect(result.success).toBe(false)
  expect(result.error.code).toBe('API_KEY_EXPIRED')
})
```

### Integration Tests

```typescript
// Test webhook delivery with retry
test('webhook delivery retries on 5xx errors', async () => {
  const mockServer = setupMockWebhookServer()
  mockServer.respondWith(503) // Service unavailable

  const delivery = createWebhookDelivery()
  await webhookDeliveryService.deliver(delivery)

  expect(mockServer.requestCount).toBe(1)
  expect(delivery.status).toBe('pending')
  expect(delivery.nextRetryAt).toBeTruthy()
})

// Test API key scopes
test('API endpoint rejects request without required scope', async () => {
  const apiKey = await createApiKey({ scopes: ['posts:read'] })

  const response = await fetch('/api/v1/posts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey.key}` },
    body: JSON.stringify({ title: 'Test' }),
  })

  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({
    error: 'Missing required scopes: posts:write'
  })
})
```

---

## 9. Documentation Requirements

### For End Users

- **Integration Setup Guides**: Step-by-step for each integration
- **Webhook Configuration**: How to set up and test webhooks
- **Troubleshooting**: Common issues and solutions

### For Developers

- **API Reference**: Complete endpoint documentation with examples
- **Webhook Reference**: Event schemas, signature verification
- **SDK Examples**: Code snippets in multiple languages
- **Rate Limits**: Current limits and best practices
- **Changelog**: API versioning and deprecation notices

---

## 10. Future Enhancements

### Sandboxed Third-Party Code

Allow developers to upload custom JavaScript that runs in isolated environment:

```typescript
export interface PluginCode {
  manifest: IntegrationManifest
  code: string  // JavaScript bundle
  runtime: 'node' | 'deno' | 'isolate'
}

// Execute in VM with limited APIs
const result = await sandbox.execute(pluginCode, event, {
  timeoutMs: 5000,
  maxMemoryMb: 128,
  allowedAPIs: ['fetch', 'crypto'],
})
```

### OAuth for Third-Party Apps

Allow third-party apps to use OAuth instead of API keys:

```typescript
export interface OAuthApp {
  clientId: string
  clientSecret: string
  redirectUris: string[]
  scopes: ApiKeyScope[]
}

// Standard OAuth 2.0 authorization code flow
// GET /oauth/authorize?client_id=xxx&redirect_uri=xxx&scope=posts:read
// POST /oauth/token (exchange code for access token)
```

### GraphQL API

Complement REST API with GraphQL for flexible queries:

```graphql
query GetFeedback {
  posts(board: "feature-requests", status: "open") {
    id
    title
    voteCount
    comments {
      id
      content
      author {
        name
      }
    }
  }
}
```

---

## Conclusion

This architecture provides a **three-tier plugin system** that balances flexibility, security, and ease of use:

1. **Tier 1 (First-Party)**: OAuth-based integrations with full platform access
2. **Tier 2 (Webhooks)**: Simple HTTP callbacks for event notifications
3. **Tier 3 (Third-Party Apps)**: API key-based access with scoped permissions

The design leverages your existing strong foundation (event system, Result<T,E>, Unit of Work) while adding the missing pieces (API keys, webhooks, public API) to enable a thriving integration ecosystem.

**Next Steps**: Review this architecture, provide feedback, and I can help implement any phase of the migration path.
