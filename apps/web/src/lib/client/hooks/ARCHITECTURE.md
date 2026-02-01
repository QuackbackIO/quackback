# Hook System Architecture

## Overview

Hooks are triggered when events occur. Each hook type (Slack, Email, Discord, Webhook, Linear, etc.)
implements the same `HookHandler` interface. The orchestration layer decides WHICH hooks to trigger,
handlers decide HOW to deliver.

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Dispatch                          │
│  dispatchPostCreated() / dispatchStatusChanged() / etc.     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    processEvent()                            │
│  1. Get all hook targets (integrations + subscribers)       │
│  2. For each target, call hook.run()                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Slack   │   │  Email   │    │ Discord  │    │ Webhook  │
    │   Hook   │   │   Hook   │    │   Hook   │    │   Hook   │
    └──────────┘   └──────────┘    └──────────┘    └──────────┘
```

## Core Interface

```typescript
interface HookHandler {
  run(event: EventData, target: unknown, config: Record<string, unknown>): Promise<HookResult>
  testConnection?(config: Record<string, unknown>): Promise<TestResult>
}

interface HookResult {
  success: boolean
  externalId?: string // Slack ts, Discord message id, Linear issue id
  externalUrl?: string // Linear issue URL, etc.
  error?: string
  shouldRetry?: boolean
}
```

## File Structure

```
lib/
├── events/
│   ├── dispatch.ts      # Fire-and-forget: dispatchPostCreated(), etc.
│   ├── process.ts       # Orchestration: processEvent()
│   ├── targets.ts       # Query layer: getHookTargets()
│   └── types.ts         # Event types
│
└── hooks/
    ├── index.ts         # Registry: getHook(), registerHook()
    ├── types.ts         # HookHandler, HookResult, HookTarget
    ├── utils.ts         # Shared: stripHtml, truncate, isRetryable
    │
    ├── slack/
    │   ├── handler.ts   # SlackHook
    │   ├── message.ts   # Block Kit formatting
    │   └── oauth.ts     # OAuth utilities
    │
    ├── email/
    │   ├── handler.ts   # EmailHook
    │   └── templates.ts # Email formatting helpers
    │
    ├── discord/
    │   ├── handler.ts   # DiscordHook
    │   └── message.ts   # Embed formatting
    │
    ├── webhook/
    │   └── handler.ts   # Generic outgoing webhooks
    │
    └── linear/
        └── handler.ts   # LinearHook
```

## How It Works

### 1. Event Dispatch (fire-and-forget)

```typescript
// events/dispatch.ts
export function dispatchPostCreated(actor: EventActor, post: PostInput): void {
  const event: PostCreatedEvent = {
    id: randomUUID(),
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor,
    data: { post },
  }

  // Fire and forget
  processEvent(event).catch((err) => console.error('[Event] Failed:', err))
}
```

### 2. Get Hook Targets

```typescript
// events/targets.ts
export async function getHookTargets(event: EventData): Promise<HookTarget[]> {
  const targets: HookTarget[] = []

  // Integration hooks (Slack, Discord, Linear, Webhook)
  const integrationTargets = await getIntegrationTargets(event)
  targets.push(...integrationTargets)

  // Email hooks (subscribers)
  if (event.type === 'post.status_changed' || event.type === 'comment.created') {
    const emailTargets = await getEmailTargets(event)
    targets.push(...emailTargets)
  }

  return targets
}

async function getIntegrationTargets(event: EventData): Promise<HookTarget[]> {
  // Single query: active mappings with integration config
  const mappings = await db
    .select({ ... })
    .from(integrationEventMappings)
    .innerJoin(integrations, ...)
    .where(and(
      eq(eventType, event.type),
      eq(enabled, true),
      eq(status, 'active')
    ))

  return mappings.map(m => ({
    type: m.integrationType,
    target: { channelId: m.config.channelId },
    config: { accessToken: decrypt(m.accessToken) },
  }))
}

async function getEmailTargets(event: EventData): Promise<HookTarget[]> {
  const postId = extractPostId(event)
  const subscribers = await getActiveSubscribers(postId)

  // Batch load preferences (avoid N+1)
  const prefs = await batchLoadPreferences(subscribers.map(s => s.memberId))

  return subscribers
    .filter(s => !isActor(s, event.actor) && shouldNotify(s, prefs, event.type))
    .map(s => ({
      type: 'email',
      target: { email: s.email, unsubscribeUrl: buildUnsubscribeUrl(s, postId) },
      config: { workspaceName, postUrl, ...eventData },
    }))
}
```

### 3. Process Event

```typescript
// events/process.ts
export async function processEvent(event: EventData): Promise<ProcessResult> {
  console.log(`[Event] Processing ${event.type} event ${event.id}`)

  const targets = await getHookTargets(event)
  console.log(`[Event] Found ${targets.length} hook targets`)

  const results = await Promise.allSettled(
    targets.map(async ({ type, target, config }) => {
      const hook = getHook(type)
      if (!hook) {
        return { success: false, error: `Unknown hook: ${type}` }
      }
      return hook.run(event, target, config)
    })
  )

  const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.success).length
  const failed = results.length - succeeded

  console.log(`[Event] Completed: ${succeeded} succeeded, ${failed} failed`)

  return { succeeded, failed, errors: [] }
}
```

### 4. Hook Handlers

```typescript
// hooks/slack/handler.ts
import { WebClient } from '@slack/web-api'
import type { HookHandler, SlackTarget, SlackConfig } from '../types'
import { buildSlackMessage } from './message'

export const slackHook: HookHandler = {
  async run(event, target, config) {
    const { channelId } = target as SlackTarget
    const { accessToken } = config as SlackConfig

    const client = new WebClient(accessToken)
    const message = buildSlackMessage(event)

    try {
      const result = await client.chat.postMessage({ channel: channelId, ...message })
      return { success: result.ok === true, externalId: result.ts }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: isRetryableError(error),
      }
    }
  },

  async testConnection(config) {
    const { accessToken } = config as SlackConfig
    const client = new WebClient(accessToken)
    const result = await client.auth.test()
    return { ok: result.ok === true, error: result.error }
  },
}

// Register
registerHook('slack', slackHook)
```

```typescript
// hooks/email/handler.ts
import { sendStatusChangeEmail, sendNewCommentEmail } from '@quackback/email'
import type { HookHandler, EmailTarget, EmailConfig } from '../types'

export const emailHook: HookHandler = {
  async run(event, target, config) {
    const { email, unsubscribeUrl } = target as EmailTarget
    const cfg = config as EmailConfig

    try {
      if (event.type === 'post.status_changed') {
        await sendStatusChangeEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          previousStatus: cfg.previousStatus!,
          newStatus: cfg.newStatus!,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
        })
      } else if (event.type === 'comment.created') {
        await sendNewCommentEmail({
          to: email,
          postTitle: cfg.postTitle,
          postUrl: cfg.postUrl,
          commenterName: cfg.commenterName!,
          commentPreview: cfg.commentPreview!,
          isTeamMember: cfg.isTeamMember!,
          workspaceName: cfg.workspaceName,
          unsubscribeUrl,
        })
      }
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: true,
      }
    }
  },
}

// Register
registerHook('email', emailHook)
```

```typescript
// hooks/webhook/handler.ts
import crypto from 'crypto'
import type { HookHandler, WebhookTarget, WebhookConfig } from '../types'

export const webhookHook: HookHandler = {
  async run(event, target, config) {
    const { url } = target as WebhookTarget
    const { secret, headers = {} } = config as WebhookConfig

    const payload = JSON.stringify({
      event: event.type,
      timestamp: event.timestamp,
      data: event.data,
    })

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    }

    // HMAC signature if secret provided
    if (secret) {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      requestHeaders['X-Signature'] = `sha256=${signature}`
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: payload,
      })
      return { success: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        shouldRetry: isRetryableError(error),
      }
    }
  },
}

// Register
registerHook('webhook', webhookHook)
```

## Adding a New Hook

1. Create `hooks/{type}/handler.ts`
2. Implement `HookHandler` interface (just the `run` method)
3. Call `registerHook('{type}', yourHook)` at the end
4. Add UI for configuration if needed

Each hook is ~30-50 lines. No abstract classes, no inheritance, just implement `run()`.

## Benefits

- **Unified pattern**: All hooks work the same way
- **Easy to add**: New hook = ~40 lines
- **Parallel execution**: All targets via `Promise.allSettled`
- **Batched queries**: Preferences loaded once, not N+1
- **Extensible**: Webhooks, Linear, Jira, Discord all fit the same model
- **Testable**: Each hook is a pure function
