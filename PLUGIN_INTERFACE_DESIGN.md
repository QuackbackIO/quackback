# Quackback Plugin Interface Design

## Philosophy

**Single, unified interface** for all plugins. Webhooks, Slack, GitHub, and future integrations all implement the same core abstraction.

---

## Core Plugin Interface

```typescript
// packages/integrations/src/base/plugin.ts

/**
 * Core plugin interface - all integrations implement this
 */
export interface Plugin {
  /** Unique identifier (e.g., 'slack', 'webhook', 'github') */
  readonly id: string

  /** Human-readable name */
  readonly name: string

  /** What events this plugin can respond to */
  readonly supportedEvents: DomainEventType[]

  /**
   * Process a domain event
   * @returns Result with optional external entity reference
   */
  handle(
    event: DomainEvent,
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<PluginResult, PluginError>>

  /**
   * Validate plugin configuration
   * @returns Result indicating if config is valid
   */
  validateConfig(config: PluginConfig): Promise<Result<void, PluginError>>

  /**
   * Test connection/configuration
   * @returns Result with connection status
   */
  testConnection?(
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<void, PluginError>>
}

/**
 * Plugin configuration - opaque to the framework
 */
export interface PluginConfig {
  /** Plugin-specific settings (e.g., channel ID, webhook URL) */
  settings: Record<string, unknown>

  /** Optional event filtering */
  filters?: {
    boardIds?: string[]
    statusIds?: string[]
    tagIds?: string[]
  }

  /** Optional event transformation */
  transform?: {
    template?: string
    fields?: Record<string, string>
  }
}

/**
 * Runtime context provided to plugins
 */
export interface PluginContext {
  workspaceId: string
  installationId: string  // Unique installation instance

  /** Encrypted credentials (OAuth tokens, API keys, secrets) */
  credentials: PluginCredentials

  /** Resilience services */
  circuitBreaker: CircuitBreaker
  idempotency: IdempotencyChecker

  /** Optional Redis for caching */
  redis?: Redis
}

/**
 * Plugin credentials (encrypted at rest)
 */
export interface PluginCredentials {
  type: 'oauth' | 'api_key' | 'webhook_secret' | 'none'

  oauth?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: Date
  }

  apiKey?: {
    key: string
  }

  webhookSecret?: {
    secret: string
  }
}

/**
 * Result of plugin execution
 */
export interface PluginResult {
  /** Whether processing was successful */
  success: boolean

  /** Optional reference to created external entity */
  externalEntity?: {
    id: string        // e.g., Slack message timestamp, GitHub issue number
    url?: string      // Deep link to the entity
    metadata?: Record<string, unknown>
  }

  /** Optional message for logging */
  message?: string
}

/**
 * Plugin error types
 */
export interface PluginError {
  code: string
  message: string
  retryable: boolean  // Should the framework retry this?
  cause?: unknown
}
```

---

## Database Schema (Simplified)

```typescript
// packages/db/src/schema/plugins.ts

/**
 * Plugin installations - one per workspace per plugin type
 */
export const pluginInstallations = pgTable('plugin_installations', {
  id: typeIdWithDefault('plugin')('id').primaryKey(),

  // Plugin identity
  pluginId: varchar('plugin_id', { length: 50 }).notNull(), // 'slack', 'webhook', etc.

  // Status
  status: varchar('status', { length: 20 }).notNull().default('active'),
  // 'active' | 'paused' | 'error' | 'disabled'

  // Encrypted credentials
  credentialsEncrypted: text('credentials_encrypted'),

  // Plugin configuration (settings, filters, etc.)
  config: jsonb('config').notNull().default({}),

  // Metadata
  installedByMemberId: typeIdColumn('member')('installed_by_member_id'),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  lastEventAt: timestamp('last_event_at'),
  lastErrorAt: timestamp('last_error_at'),
  lastError: text('last_error'),

  // Unique: one installation per plugin type per workspace
})

/**
 * Plugin event subscriptions - which events trigger which plugins
 */
export const pluginSubscriptions = pgTable('plugin_subscriptions', {
  id: typeIdWithDefault('sub')('id').primaryKey(),

  installationId: typeIdColumn('plugin')('installation_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),

  enabled: boolean('enabled').notNull().default(true),

  // Unique: one subscription per installation per event type
})

/**
 * Plugin execution log
 */
export const pluginExecutions = pgTable('plugin_executions', {
  id: typeIdWithDefault('exec')('id').primaryKey(),

  installationId: typeIdColumn('plugin')('installation_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),

  status: varchar('status', { length: 20 }).notNull(),
  // 'success' | 'failed' | 'retrying'

  attempt: integer('attempt').notNull().default(1),
  durationMs: integer('duration_ms'),

  externalEntityId: text('external_entity_id'),
  externalEntityUrl: text('external_entity_url'),

  error: text('error'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

---

## Plugin Registry

```typescript
// packages/integrations/src/registry.ts

/**
 * Central plugin registry
 */
export class PluginRegistry {
  private plugins = new Map<string, Plugin>()

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id)
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  supports(pluginId: string, eventType: DomainEventType): boolean {
    const plugin = this.get(pluginId)
    return plugin?.supportedEvents.includes(eventType) ?? false
  }
}

// Global singleton
export const pluginRegistry = new PluginRegistry()
```

---

## Plugin Executor (Framework)

```typescript
// packages/integrations/src/executor.ts

/**
 * Executes plugins in response to domain events
 */
export class PluginExecutor {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly db: Database,
    private readonly redis: Redis
  ) {}

  /**
   * Execute all subscribed plugins for an event
   */
  async executeForEvent(
    event: DomainEvent,
    workspaceId: string
  ): Promise<ExecutionSummary> {
    // Find all active installations subscribed to this event
    const installations = await this.findSubscribedInstallations(
      workspaceId,
      event.type
    )

    const results: ExecutionResult[] = []

    // Execute each plugin
    for (const installation of installations) {
      const result = await this.executeSingle(event, installation)
      results.push(result)
    }

    return {
      eventId: event.id,
      totalPlugins: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    }
  }

  /**
   * Execute a single plugin installation
   */
  private async executeSingle(
    event: DomainEvent,
    installation: PluginInstallation
  ): Promise<ExecutionResult> {
    const plugin = this.registry.get(installation.pluginId)

    if (!plugin) {
      return {
        installationId: installation.id,
        success: false,
        error: `Plugin ${installation.pluginId} not found`,
      }
    }

    // Build context
    const context: PluginContext = {
      workspaceId: installation.workspaceId,
      installationId: installation.id,
      credentials: await this.decryptCredentials(installation),
      circuitBreaker: new CircuitBreaker(installation.id, this.redis),
      idempotency: new IdempotencyChecker(this.redis),
      redis: this.redis,
    }

    // Check idempotency
    const cacheKey = `plugin:${installation.id}:event:${event.id}`
    const alreadyProcessed = await context.idempotency.check(cacheKey)
    if (alreadyProcessed) {
      return {
        installationId: installation.id,
        success: true,
        skipped: true,
        reason: 'already_processed',
      }
    }

    // Check circuit breaker
    if (!await context.circuitBreaker.canExecute()) {
      return {
        installationId: installation.id,
        success: false,
        error: 'Circuit breaker open',
        retryable: true,
      }
    }

    const startTime = Date.now()

    try {
      // Execute plugin
      const result = await plugin.handle(event, installation.config, context)

      const duration = Date.now() - startTime

      if (result.success) {
        // Mark as processed
        await context.idempotency.mark(cacheKey, 604800) // 7 days
        await context.circuitBreaker.recordSuccess()

        // Log execution
        await this.logExecution({
          installationId: installation.id,
          eventId: event.id,
          eventType: event.type,
          status: 'success',
          durationMs: duration,
          externalEntityId: result.value.externalEntity?.id,
          externalEntityUrl: result.value.externalEntity?.url,
        })

        return {
          installationId: installation.id,
          success: true,
          externalEntity: result.value.externalEntity,
          duration,
        }
      } else {
        // Error handling
        await context.circuitBreaker.recordFailure()

        await this.logExecution({
          installationId: installation.id,
          eventId: event.id,
          eventType: event.type,
          status: 'failed',
          durationMs: duration,
          error: result.error.message,
        })

        return {
          installationId: installation.id,
          success: false,
          error: result.error.message,
          retryable: result.error.retryable,
          duration,
        }
      }
    } catch (error) {
      await context.circuitBreaker.recordFailure()

      return {
        installationId: installation.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      }
    }
  }

  private async findSubscribedInstallations(
    workspaceId: string,
    eventType: DomainEventType
  ): Promise<PluginInstallation[]> {
    return this.db
      .select()
      .from(pluginInstallations)
      .innerJoin(
        pluginSubscriptions,
        eq(pluginSubscriptions.installationId, pluginInstallations.id)
      )
      .where(
        and(
          eq(pluginInstallations.workspaceId, workspaceId),
          eq(pluginInstallations.status, 'active'),
          eq(pluginSubscriptions.eventType, eventType),
          eq(pluginSubscriptions.enabled, true)
        )
      )
  }

  private async decryptCredentials(
    installation: PluginInstallation
  ): Promise<PluginCredentials> {
    // Decrypt encrypted credentials using workspace key
    const decrypted = decrypt(
      installation.credentialsEncrypted,
      installation.workspaceId
    )
    return JSON.parse(decrypted)
  }

  private async logExecution(data: LogExecutionData): Promise<void> {
    await this.db.insert(pluginExecutions).values(data)
  }
}
```

---

## Example Implementations

### 1. Slack Plugin

```typescript
// packages/integrations/src/plugins/slack.ts

export class SlackPlugin implements Plugin {
  readonly id = 'slack'
  readonly name = 'Slack'
  readonly supportedEvents: DomainEventType[] = [
    'post.created',
    'post.status_changed',
    'comment.created',
    'changelog.published',
  ]

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<PluginResult, PluginError>> {
    if (context.credentials.type !== 'oauth') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Slack requires OAuth credentials',
        retryable: false,
      })
    }

    const client = new WebClient(context.credentials.oauth!.accessToken)

    // Get channel from config
    const channelId = config.settings.channelId as string
    if (!channelId) {
      return err({
        code: 'MISSING_CONFIG',
        message: 'channelId is required',
        retryable: false,
      })
    }

    // Build message based on event type
    const message = this.buildMessage(event, config)

    try {
      // Post to Slack
      const response = await client.chat.postMessage({
        channel: channelId,
        ...message,
      })

      if (!response.ok) {
        return err({
          code: 'SLACK_ERROR',
          message: response.error || 'Unknown Slack error',
          retryable: this.isRetryable(response.error),
        })
      }

      return ok({
        success: true,
        externalEntity: {
          id: response.ts!,
          url: `slack://channel?team=${response.team}&id=${channelId}&message=${response.ts}`,
        },
        message: `Posted to Slack channel ${channelId}`,
      })
    } catch (error) {
      return err({
        code: 'SLACK_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
        retryable: true,
      })
    }
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    if (!config.settings.channelId) {
      return err({
        code: 'MISSING_CHANNEL',
        message: 'channelId is required',
        retryable: false,
      })
    }

    return ok(undefined)
  }

  async testConnection(
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<void, PluginError>> {
    if (context.credentials.type !== 'oauth') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'OAuth token required',
        retryable: false,
      })
    }

    const client = new WebClient(context.credentials.oauth!.accessToken)

    try {
      const response = await client.auth.test()

      if (!response.ok) {
        return err({
          code: 'AUTH_FAILED',
          message: 'Invalid or expired token',
          retryable: false,
        })
      }

      return ok(undefined)
    } catch (error) {
      return err({
        code: 'CONNECTION_FAILED',
        message: error instanceof Error ? error.message : 'Connection failed',
        retryable: true,
      })
    }
  }

  private buildMessage(event: DomainEvent, config: PluginConfig) {
    // Use custom template if provided
    if (config.transform?.template) {
      return this.applyTemplate(event, config.transform.template)
    }

    // Default formatting based on event type
    switch (event.type) {
      case 'post.created':
        return this.formatPostCreated(event)
      case 'post.status_changed':
        return this.formatStatusChanged(event)
      case 'comment.created':
        return this.formatCommentCreated(event)
      default:
        return { text: `Event: ${event.type}` }
    }
  }

  private formatPostCreated(event: DomainEvent) {
    const { post } = event.data
    return {
      text: `New post: ${post.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${post.title}*\n${post.description || ''}`,
          },
        },
      ],
    }
  }

  // ... other formatting methods

  private isRetryable(error?: string): boolean {
    const retryableErrors = ['rate_limited', 'timeout', 'internal_error']
    return retryableErrors.some(e => error?.includes(e))
  }
}

// Register plugin
pluginRegistry.register(new SlackPlugin())
```

### 2. Webhook Plugin

```typescript
// packages/integrations/src/plugins/webhook.ts

export class WebhookPlugin implements Plugin {
  readonly id = 'webhook'
  readonly name = 'Custom Webhook'
  readonly supportedEvents: DomainEventType[] = [
    'post.created',
    'post.updated',
    'post.status_changed',
    'post.deleted',
    'comment.created',
    'comment.deleted',
    'vote.created',
    'vote.deleted',
    'changelog.published',
  ]

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<PluginResult, PluginError>> {
    if (context.credentials.type !== 'webhook_secret') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Webhook secret required',
        retryable: false,
      })
    }

    const url = config.settings.url as string
    const secret = context.credentials.webhookSecret!.secret
    const headers = (config.settings.headers as Record<string, string>) || {}

    // Build payload
    const payload = JSON.stringify(event)

    // Sign payload
    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex')

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Quackback-Webhooks/1.0',
          'X-Quackback-Signature': signature,
          'X-Quackback-Event-Type': event.type,
          'X-Quackback-Event-Id': event.id,
          'X-Quackback-Delivery-Id': context.installationId,
          ...headers,
        },
        body: payload,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (!response.ok) {
        // Check if endpoint explicitly says "stop retrying"
        if (response.status === 410) {
          return err({
            code: 'WEBHOOK_GONE',
            message: 'Endpoint returned 410 Gone - webhook should be disabled',
            retryable: false,
          })
        }

        return err({
          code: 'WEBHOOK_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
          retryable: response.status >= 500 || response.status === 429,
        })
      }

      return ok({
        success: true,
        message: `Webhook delivered to ${url}`,
      })
    } catch (error) {
      return err({
        code: 'WEBHOOK_DELIVERY_FAILED',
        message: error instanceof Error ? error.message : 'Delivery failed',
        retryable: true,
      })
    }
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    const url = config.settings.url as string

    if (!url) {
      return err({
        code: 'MISSING_URL',
        message: 'url is required',
        retryable: false,
      })
    }

    // Validate URL format
    try {
      const parsed = new URL(url)

      // Security: block localhost and internal IPs
      if (parsed.hostname === 'localhost' || parsed.hostname.startsWith('127.')) {
        return err({
          code: 'INVALID_URL',
          message: 'Cannot use localhost or internal IPs',
          retryable: false,
        })
      }

      return ok(undefined)
    } catch {
      return err({
        code: 'INVALID_URL',
        message: 'Invalid URL format',
        retryable: false,
      })
    }
  }

  async testConnection(
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<void, PluginError>> {
    // Send a test ping event
    const testEvent: DomainEvent = {
      id: 'test',
      type: 'post.created',
      workspaceId: context.workspaceId,
      timestamp: new Date().toISOString(),
      actor: { type: 'system' },
      data: { test: true },
    }

    const result = await this.handle(testEvent, config, context)

    if (!result.success) {
      return err(result.error)
    }

    return ok(undefined)
  }
}

// Register plugin
pluginRegistry.register(new WebhookPlugin())
```

### 3. GitHub Plugin (Future)

```typescript
// packages/integrations/src/plugins/github.ts

export class GitHubPlugin implements Plugin {
  readonly id = 'github'
  readonly name = 'GitHub'
  readonly supportedEvents: DomainEventType[] = [
    'post.created',
    'post.status_changed',
  ]

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<PluginResult, PluginError>> {
    // Create GitHub issue when post is created
    if (event.type === 'post.created') {
      return this.createIssue(event, config, context)
    }

    // Update issue labels when status changes
    if (event.type === 'post.status_changed') {
      return this.updateIssue(event, config, context)
    }

    return err({
      code: 'UNSUPPORTED_EVENT',
      message: `Event ${event.type} not supported`,
      retryable: false,
    })
  }

  private async createIssue(
    event: DomainEvent,
    config: PluginConfig,
    context: PluginContext
  ): Promise<Result<PluginResult, PluginError>> {
    const octokit = new Octokit({
      auth: context.credentials.oauth!.accessToken,
    })

    const repo = config.settings.repository as string
    const [owner, repoName] = repo.split('/')

    const { post } = event.data

    try {
      const { data } = await octokit.rest.issues.create({
        owner,
        repo: repoName,
        title: post.title,
        body: post.description,
        labels: ['quackback', post.boardSlug],
      })

      return ok({
        success: true,
        externalEntity: {
          id: data.number.toString(),
          url: data.html_url,
        },
        message: `Created GitHub issue #${data.number}`,
      })
    } catch (error) {
      return err({
        code: 'GITHUB_ERROR',
        message: error instanceof Error ? error.message : 'GitHub API error',
        retryable: true,
      })
    }
  }

  // ... validateConfig, testConnection
}

// Register plugin
pluginRegistry.register(new GitHubPlugin())
```

---

## Usage in Job Processor

```typescript
// packages/jobs/src/processors/event.ts

import { PluginExecutor, pluginRegistry } from '@quackback/integrations'

export async function processEvent(
  data: EventJobData,
  redis: Redis,
  db: Database
): Promise<EventJobResult> {
  const executor = new PluginExecutor(pluginRegistry, db, redis)

  // Execute all subscribed plugins
  const summary = await executor.executeForEvent(data, data.workspaceId)

  return {
    eventId: data.id,
    pluginsExecuted: summary.totalPlugins,
    successful: summary.successful,
    failed: summary.failed,
  }
}
```

---

## Admin UI - Plugin Installation

```typescript
// apps/web/app/admin/plugins/[pluginId]/install/actions.ts

'use server'

import { pluginRegistry } from '@quackback/integrations'

export async function installPlugin(
  pluginId: string,
  config: PluginConfig,
  credentials: PluginCredentials
) {
  const { workspace } = await requireTenantRole(['owner', 'admin'])

  // Validate plugin exists
  const plugin = pluginRegistry.get(pluginId)
  if (!plugin) {
    return { error: 'Plugin not found' }
  }

  // Validate configuration
  const validation = await plugin.validateConfig(config)
  if (!validation.success) {
    return { error: validation.error.message }
  }

  // Encrypt credentials
  const encryptedCreds = encrypt(JSON.stringify(credentials), workspace.id)

  // Create installation
  const [installation] = await db.insert(pluginInstallations).values({
    pluginId,
    workspaceId: workspace.id,
    credentialsEncrypted: encryptedCreds,
    config,
    status: 'active',
    installedByMemberId: ctx.memberId,
  }).returning()

  // Subscribe to all supported events
  await Promise.all(
    plugin.supportedEvents.map(eventType =>
      db.insert(pluginSubscriptions).values({
        installationId: installation.id,
        eventType,
        enabled: true,
      })
    )
  )

  revalidatePath('/admin/plugins')
  return { success: true, installation }
}
```

---

## Key Benefits of This Design

### 1. **Single Abstraction**
- All plugins implement the same `Plugin` interface
- Webhooks are just another plugin
- Consistent handling, logging, retries

### 2. **Framework Handles Complexity**
- Circuit breaker
- Idempotency
- Credential management
- Error handling
- Logging

### 3. **Plugins Stay Simple**
- Focus on business logic only
- Return `Result<PluginResult, PluginError>`
- Framework does the rest

### 4. **Easy to Extend**
- New plugin? Implement `Plugin` interface
- Register with `pluginRegistry.register()`
- Done!

### 5. **Type-Safe Configuration**
- Each plugin validates its own config
- Opaque to framework
- Can use Zod schemas internally

### 6. **Future-Proof**
- Third-party plugins just implement `Plugin`
- Same interface for sandboxed code
- Same interface for webhook delivery

---

## Comparison

### Before (Three Separate Systems)
```
OAuth Integrations → BaseIntegration → Custom processing
Webhooks          → WebhookDelivery  → Different system
Third-party Apps  → API Keys         → Different system
```

### After (One Unified System)
```
All Plugins → Plugin Interface → PluginExecutor → Done
  ├─ SlackPlugin
  ├─ WebhookPlugin
  ├─ GitHubPlugin
  └─ CustomPlugin
```

---

## Next Steps

1. **Migrate existing Slack integration** to use `Plugin` interface
2. **Implement `WebhookPlugin`** on top of same interface
3. **Build `PluginExecutor`** framework
4. **Add GitHub plugin** using same pattern
5. **Future**: Sandbox third-party code that implements `Plugin`
