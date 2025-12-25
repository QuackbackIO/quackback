# Quackback Plugin Interface Design

## Philosophy

**Absolute minimal interface**. Plugins handle events with config and credentials. That's it.

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
   * Plugins handle their own retries, idempotency, and error strategies
   */
  handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>>

  /**
   * Validate plugin configuration
   */
  validateConfig(config: PluginConfig): Promise<Result<void, PluginError>>
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
  cause?: unknown
}
```

---

## Database Schema

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
  // 'active' | 'paused' | 'disabled'

  // Encrypted credentials
  credentialsEncrypted: text('credentials_encrypted'),

  // Plugin configuration (settings, filters, etc.)
  config: jsonb('config').notNull().default({}),

  // Metadata
  installedByMemberId: typeIdColumn('member')('installed_by_member_id'),
  installedAt: timestamp('installed_at').defaultNow().notNull(),
  lastEventAt: timestamp('last_event_at'),
})

/**
 * Plugin event subscriptions - which events trigger which plugins
 */
export const pluginSubscriptions = pgTable('plugin_subscriptions', {
  id: typeIdWithDefault('sub')('id').primaryKey(),

  installationId: typeIdColumn('plugin')('installation_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),

  enabled: boolean('enabled').notNull().default(true),
})

/**
 * Plugin execution log (optional - for auditing)
 */
export const pluginExecutions = pgTable('plugin_executions', {
  id: typeIdWithDefault('exec')('id').primaryKey(),

  installationId: typeIdColumn('plugin')('installation_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),

  status: varchar('status', { length: 20 }).notNull(),
  // 'success' | 'failed'

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

## Plugin Executor (Simple Framework)

```typescript
// packages/integrations/src/executor.ts

/**
 * Executes plugins in response to domain events
 */
export class PluginExecutor {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly db: Database
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

    // Decrypt credentials
    const credentials = await this.decryptCredentials(installation)

    const startTime = Date.now()

    try {
      // Execute plugin - plugin handles everything internally
      const result = await plugin.handle(event, installation.config, credentials)

      const duration = Date.now() - startTime

      if (result.success) {
        // Update last event timestamp
        await this.db
          .update(pluginInstallations)
          .set({ lastEventAt: new Date() })
          .where(eq(pluginInstallations.id, installation.id))

        // Optional: Log execution
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
        // Log error
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
          duration,
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime

      await this.logExecution({
        installationId: installation.id,
        eventId: event.id,
        eventType: event.type,
        status: 'failed',
        durationMs: duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      return {
        installationId: installation.id,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
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
    if (!installation.credentialsEncrypted) {
      return { type: 'none' }
    }

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

## Project Structure for Custom Plugins

```
packages/integrations/
├── src/
│   ├── base/
│   │   ├── plugin.ts           # Plugin interface, types
│   │   └── index.ts
│   │
│   ├── registry.ts             # PluginRegistry class
│   ├── executor.ts             # PluginExecutor class
│   │
│   ├── plugins/                # 🔥 Core plugins (shipped with Quackback)
│   │   ├── slack/
│   │   │   ├── plugin.ts       # SlackPlugin implementation
│   │   │   ├── oauth.ts        # OAuth helpers
│   │   │   └── index.ts
│   │   │
│   │   ├── webhook/
│   │   │   ├── plugin.ts       # WebhookPlugin implementation
│   │   │   └── index.ts
│   │   │
│   │   ├── github/
│   │   │   ├── plugin.ts       # GitHubPlugin implementation
│   │   │   ├── oauth.ts
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts            # Export all core plugins
│   │
│   └── index.ts                # Main exports
│
├── package.json
└── tsconfig.json


# Custom plugins added by users/developers
packages/integrations-custom/       # 🎨 Optional: User-added custom plugins
├── src/
│   ├── linear/
│   │   ├── plugin.ts
│   │   └── index.ts
│   │
│   ├── jira/
│   │   ├── plugin.ts
│   │   └── index.ts
│   │
│   ├── discord/
│   │   ├── plugin.ts
│   │   └── index.ts
│   │
│   └── index.ts                # Export custom plugins
│
├── package.json
└── tsconfig.json


# App initialization (register all plugins)
apps/web/
├── lib/
│   └── plugins/
│       └── register.ts         # Register all plugins at startup
│
└── app/
    └── api/
        └── plugins/
            ├── [id]/
            │   └── install/
            │       └── route.ts
            └── route.ts
```

---

## Example Implementations

### Example: Core Plugin (Slack)

```typescript
// packages/integrations/src/plugins/slack/plugin.ts

import { WebClient } from '@slack/web-api'
import { ok, err } from '@quackback/domain'
import type { Plugin, PluginConfig, PluginCredentials, PluginResult, PluginError } from '../../base/plugin'

export class SlackPlugin implements Plugin {
  readonly id = 'slack'
  readonly name = 'Slack'
  readonly supportedEvents = [
    'post.created',
    'post.status_changed',
    'comment.created',
    'changelog.published',
  ] as const

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>> {
    // Validate credentials
    if (credentials.type !== 'oauth') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Slack requires OAuth credentials',
      })
    }

    const client = new WebClient(credentials.oauth.accessToken)
    const channelId = config.settings.channelId as string

    if (!channelId) {
      return err({
        code: 'MISSING_CONFIG',
        message: 'channelId is required',
      })
    }

    try {
      // Build and send message
      const message = this.buildMessage(event, config)

      const response = await client.chat.postMessage({
        channel: channelId,
        ...message,
      })

      if (!response.ok) {
        return err({
          code: 'SLACK_ERROR',
          message: response.error || 'Unknown Slack error',
        })
      }

      return ok({
        success: true,
        externalEntity: {
          id: response.ts!,
          url: `slack://channel?id=${channelId}&message=${response.ts}`,
        },
        message: `Posted to Slack channel ${channelId}`,
      })
    } catch (error) {
      return err({
        code: 'SLACK_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    if (!config.settings.channelId) {
      return err({
        code: 'MISSING_CHANNEL',
        message: 'channelId is required',
      })
    }

    return ok(undefined)
  }

  private buildMessage(event: DomainEvent, config: PluginConfig) {
    // Use custom template if provided
    if (config.transform?.template) {
      return this.applyTemplate(event, config.transform.template)
    }

    // Default formatting
    switch (event.type) {
      case 'post.created':
        return this.formatPostCreated(event)
      case 'post.status_changed':
        return this.formatStatusChanged(event)
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

  private formatStatusChanged(event: DomainEvent) {
    const { post, previousStatus, newStatus } = event.data
    return {
      text: `Status updated: ${post.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${post.title}*\n${previousStatus} → *${newStatus}*`,
          },
        },
      ],
    }
  }

  private applyTemplate(event: DomainEvent, template: string) {
    // Simple template replacement (or use a library like Handlebars)
    const rendered = template
      .replace(/{{event\.type}}/g, event.type)
      .replace(/{{event\.data\.post\.title}}/g, event.data.post?.title || '')
      .replace(/{{event\.data\.post\.description}}/g, event.data.post?.description || '')

    return { text: rendered }
  }
}
```

```typescript
// packages/integrations/src/plugins/slack/index.ts
export { SlackPlugin } from './plugin'
export * from './oauth'
```

---

### Example: Core Plugin (Webhook)

```typescript
// packages/integrations/src/plugins/webhook/plugin.ts

import { createHmac } from 'crypto'
import { ok, err } from '@quackback/domain'
import type { Plugin, PluginConfig, PluginCredentials, PluginResult, PluginError } from '../../base/plugin'

export class WebhookPlugin implements Plugin {
  readonly id = 'webhook'
  readonly name = 'Custom Webhook'
  readonly supportedEvents = [
    'post.created',
    'post.updated',
    'post.status_changed',
    'post.deleted',
    'comment.created',
    'comment.deleted',
    'vote.created',
    'vote.deleted',
    'changelog.published',
  ] as const

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>> {
    if (credentials.type !== 'webhook_secret') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Webhook secret required',
      })
    }

    const url = config.settings.url as string
    const secret = credentials.webhookSecret.secret
    const headers = (config.settings.headers as Record<string, string>) || {}

    // Plugin handles its own retry logic
    const maxAttempts = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.deliver(event, url, secret, headers)

        if (result.success) {
          return ok(result.value)
        }

        // Check if we should retry
        if (!this.shouldRetry(result.error, attempt, maxAttempts)) {
          return result
        }

        lastError = new Error(result.error.message)

        // Exponential backoff: 5s, 25s, 125s
        const backoff = 5000 * Math.pow(5, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, backoff))

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')
      }
    }

    return err({
      code: 'WEBHOOK_EXHAUSTED',
      message: `Failed after ${maxAttempts} attempts: ${lastError?.message}`,
    })
  }

  private async deliver(
    event: DomainEvent,
    url: string,
    secret: string,
    headers: Record<string, string>
  ): Promise<Result<PluginResult, PluginError>> {
    const payload = JSON.stringify(event)
    const signature = createHmac('sha256', secret).update(payload).digest('hex')

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Quackback-Webhooks/1.0',
          'X-Quackback-Signature': signature,
          'X-Quackback-Event-Type': event.type,
          'X-Quackback-Event-Id': event.id,
          ...headers,
        },
        body: payload,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (!response.ok) {
        // 410 Gone = stop retrying
        if (response.status === 410) {
          return err({
            code: 'WEBHOOK_GONE',
            message: 'Endpoint returned 410 Gone',
          })
        }

        return err({
          code: 'WEBHOOK_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
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
      })
    }
  }

  private shouldRetry(error: PluginError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false

    // Don't retry 410 Gone
    if (error.code === 'WEBHOOK_GONE') return false

    // Don't retry config errors
    if (error.code === 'INVALID_URL') return false

    // Retry network errors and 5xx
    return true
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    const url = config.settings.url as string

    if (!url) {
      return err({
        code: 'MISSING_URL',
        message: 'url is required',
      })
    }

    try {
      const parsed = new URL(url)

      // Security: block localhost
      if (parsed.hostname === 'localhost' || parsed.hostname.startsWith('127.')) {
        return err({
          code: 'INVALID_URL',
          message: 'Cannot use localhost',
        })
      }

      return ok(undefined)
    } catch {
      return err({
        code: 'INVALID_URL',
        message: 'Invalid URL format',
      })
    }
  }
}
```

---

### Example: Custom Plugin (Linear)

```typescript
// packages/integrations-custom/src/linear/plugin.ts

import { LinearClient } from '@linear/sdk'
import { ok, err } from '@quackback/domain'
import type { Plugin, PluginConfig, PluginCredentials, PluginResult, PluginError } from '@quackback/integrations'

export class LinearPlugin implements Plugin {
  readonly id = 'linear'
  readonly name = 'Linear'
  readonly supportedEvents = [
    'post.created',
    'post.status_changed',
  ] as const

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>> {
    if (credentials.type !== 'api_key') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Linear requires API key',
      })
    }

    const client = new LinearClient({
      apiKey: credentials.apiKey.key,
    })

    const teamId = config.settings.teamId as string

    if (event.type === 'post.created') {
      return this.createIssue(event, teamId, client)
    }

    if (event.type === 'post.status_changed') {
      return this.updateIssue(event, client)
    }

    return err({
      code: 'UNSUPPORTED_EVENT',
      message: `Event ${event.type} not supported`,
    })
  }

  private async createIssue(
    event: DomainEvent,
    teamId: string,
    client: LinearClient
  ): Promise<Result<PluginResult, PluginError>> {
    const { post } = event.data

    try {
      const issue = await client.createIssue({
        teamId,
        title: post.title,
        description: post.description,
        labels: ['quackback'],
      })

      const issueId = issue.issue?.id

      if (!issueId) {
        return err({
          code: 'LINEAR_ERROR',
          message: 'Failed to create issue',
        })
      }

      return ok({
        success: true,
        externalEntity: {
          id: issueId,
          url: `https://linear.app/issue/${issueId}`,
        },
        message: `Created Linear issue ${issueId}`,
      })
    } catch (error) {
      return err({
        code: 'LINEAR_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }

  private async updateIssue(
    event: DomainEvent,
    client: LinearClient
  ): Promise<Result<PluginResult, PluginError>> {
    // Implementation for updating issue status
    return ok({ success: true })
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    if (!config.settings.teamId) {
      return err({
        code: 'MISSING_TEAM',
        message: 'teamId is required',
      })
    }

    return ok(undefined)
  }
}
```

---

### Plugin Registration

```typescript
// apps/web/lib/plugins/register.ts

import { pluginRegistry } from '@quackback/integrations'

// Core plugins
import { SlackPlugin } from '@quackback/integrations/plugins/slack'
import { WebhookPlugin } from '@quackback/integrations/plugins/webhook'
import { GitHubPlugin } from '@quackback/integrations/plugins/github'

// Custom plugins (optional)
import { LinearPlugin } from '@quackback/integrations-custom/linear'
import { JiraPlugin } from '@quackback/integrations-custom/jira'
import { DiscordPlugin } from '@quackback/integrations-custom/discord'

/**
 * Register all plugins at app startup
 */
export function registerPlugins() {
  // Core plugins (always available)
  pluginRegistry.register(new SlackPlugin())
  pluginRegistry.register(new WebhookPlugin())
  pluginRegistry.register(new GitHubPlugin())

  // Custom plugins (conditionally register)
  if (process.env.ENABLE_LINEAR_PLUGIN === 'true') {
    pluginRegistry.register(new LinearPlugin())
  }

  if (process.env.ENABLE_JIRA_PLUGIN === 'true') {
    pluginRegistry.register(new JiraPlugin())
  }

  if (process.env.ENABLE_DISCORD_PLUGIN === 'true') {
    pluginRegistry.register(new DiscordPlugin())
  }

  console.log(`Registered ${pluginRegistry.list().length} plugins`)
}
```

```typescript
// apps/web/app/layout.tsx or next.config.js

import { registerPlugins } from '@/lib/plugins/register'

// Register plugins once at startup
registerPlugins()
```

---

## Usage in Job Processor

```typescript
// packages/jobs/src/processors/event.ts

import { PluginExecutor, pluginRegistry } from '@quackback/integrations'

export async function processEvent(
  data: EventJobData,
  db: Database
): Promise<EventJobResult> {
  const executor = new PluginExecutor(pluginRegistry, db)

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

## Benefits

✅ **Absolute Minimal** - Just `handle()` and `validateConfig()`
✅ **No Context Bloat** - Just event, config, credentials
✅ **Plugin Autonomy** - Plugins decide everything (retries, caching, etc.)
✅ **Easy to Add** - Implement 2 methods, register, done
✅ **Clear Structure** - Core vs custom plugins separated

---

## Summary

**Framework provides:**
- Event routing to subscribed plugins
- Credential decryption
- Execution logging

**Plugin handles:**
- Event processing
- Retries (if needed)
- Error handling
- Config validation

**That's it.** Clean, minimal, flexible.
