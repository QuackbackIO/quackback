# Complete Plugin Examples

End-to-end implementation examples for popular integrations using the minimal plugin interface.

---

## Example 1: Slack Integration (OAuth)

### Plugin Implementation

```typescript
// packages/integrations/src/plugins/slack/plugin.ts

import { WebClient } from '@slack/web-api'
import { ok, err, type Result } from '@quackback/domain'
import type {
  Plugin,
  PluginConfig,
  PluginCredentials,
  PluginResult,
  PluginError,
  DomainEvent
} from '../../base/plugin'

export class SlackPlugin implements Plugin {
  readonly id = 'slack'
  readonly name = 'Slack'
  readonly supportedEvents = [
    'post.created',
    'post.updated',
    'post.status_changed',
    'comment.created',
    'changelog.published',
  ] as const

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>> {
    if (credentials.type !== 'oauth') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Slack requires OAuth credentials',
      })
    }

    const client = new WebClient(credentials.oauth.accessToken)
    const channelId = config.settings.channelId as string

    try {
      const message = this.buildMessage(event, config)

      // Auto-join public channels if needed
      const response = await this.postMessageWithAutoJoin(client, channelId, message)

      if (!response.ok) {
        return err({
          code: 'SLACK_ERROR',
          message: response.error || 'Failed to post message',
        })
      }

      return ok({
        success: true,
        externalEntity: {
          id: response.ts!,
          url: this.buildMessageUrl(channelId, response.ts!),
        },
        message: 'Posted to Slack',
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

  private async postMessageWithAutoJoin(
    client: WebClient,
    channelId: string,
    message: { text: string; blocks?: unknown[] }
  ) {
    try {
      return await client.chat.postMessage({
        channel: channelId,
        ...message,
      })
    } catch (error: any) {
      // Auto-join public channels
      if (error?.data?.error === 'not_in_channel') {
        // Private channels start with 'G', public with 'C'
        if (channelId.startsWith('G')) {
          throw new Error('Bot is not in this private channel. Please invite the bot first.')
        }

        // Join the channel
        await client.conversations.join({ channel: channelId })

        // Retry posting
        return await client.chat.postMessage({
          channel: channelId,
          ...message,
        })
      }

      throw error
    }
  }

  private buildMessage(event: DomainEvent, config: PluginConfig) {
    // Custom template
    if (config.transform?.template) {
      return { text: this.applyTemplate(event, config.transform.template) }
    }

    // Event-specific formatting
    switch (event.type) {
      case 'post.created':
        return this.formatPostCreated(event)
      case 'post.status_changed':
        return this.formatStatusChanged(event)
      case 'comment.created':
        return this.formatCommentCreated(event)
      case 'changelog.published':
        return this.formatChangelog(event)
      default:
        return { text: `Event: ${event.type}` }
    }
  }

  private formatPostCreated(event: DomainEvent) {
    const { post } = event.data
    const author = event.actor.email || 'Someone'

    return {
      text: `New post from ${author}: ${post.title}`,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `📬 New post from ${author}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${post.url}|${post.title}>*\n${this.truncate(post.description, 200)}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `in <${post.boardUrl}|${post.boardSlug}>`,
            },
          ],
        },
      ],
    }
  }

  private formatStatusChanged(event: DomainEvent) {
    const { post, previousStatus, newStatus } = event.data
    const actor = event.actor.email || 'Someone'

    const emoji = this.getStatusEmoji(newStatus)

    return {
      text: `${post.title} → ${newStatus}`,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${emoji} Status updated by ${actor}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${post.url}|${post.title}>*\n> ${previousStatus} → *${newStatus}*`,
          },
        },
      ],
    }
  }

  private formatCommentCreated(event: DomainEvent) {
    const { comment, post } = event.data
    const author = event.actor.email || 'Someone'

    return {
      text: `New comment on ${post.title}`,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `💬 New comment from ${author}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${post.url}|${post.title}>*\n> ${this.truncate(comment.content, 200)}`,
          },
        },
      ],
    }
  }

  private formatChangelog(event: DomainEvent) {
    const { changelog } = event.data

    return {
      text: `New changelog: ${changelog.title}`,
      blocks: [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '📰 New changelog published',
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${changelog.url}|${changelog.title}>*\n${this.truncate(changelog.content, 200)}`,
          },
        },
      ],
    }
  }

  private getStatusEmoji(status: string): string {
    const lowerStatus = status.toLowerCase()
    if (lowerStatus.includes('open') || lowerStatus.includes('new')) return '🆕'
    if (lowerStatus.includes('progress') || lowerStatus.includes('working')) return '🔨'
    if (lowerStatus.includes('review')) return '👀'
    if (lowerStatus.includes('done') || lowerStatus.includes('complete')) return '✅'
    if (lowerStatus.includes('closed') || lowerStatus.includes('resolved')) return '✅'
    return '📌'
  }

  private applyTemplate(event: DomainEvent, template: string): string {
    return template
      .replace(/\{\{event\.type\}\}/g, event.type)
      .replace(/\{\{event\.data\.post\.title\}\}/g, event.data.post?.title || '')
      .replace(/\{\{event\.data\.post\.description\}\}/g, event.data.post?.description || '')
      .replace(/\{\{event\.actor\.email\}\}/g, event.actor.email || '')
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }

  private buildMessageUrl(channelId: string, messageTs: string): string {
    return `slack://channel?id=${channelId}&message=${messageTs}`
  }
}
```

### OAuth Helpers

```typescript
// packages/integrations/src/plugins/slack/oauth.ts

const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID!
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET!

const SLACK_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:join',
  'chat:write',
  'team:read',
]

export function getSlackOAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: SLACK_CLIENT_ID,
    scope: SLACK_SCOPES.join(','),
    redirect_uri: redirectUri,
    state,
  })

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string
  teamId: string
  teamName: string
}> {
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  })

  const data = await response.json()

  if (!data.ok) {
    throw new Error(`Slack OAuth error: ${data.error}`)
  }

  return {
    accessToken: data.access_token,
    teamId: data.team.id,
    teamName: data.team.name,
  }
}

export async function listSlackChannels(accessToken: string): Promise<
  Array<{
    id: string
    name: string
    isPrivate: boolean
  }>
> {
  const response = await fetch('https://slack.com/api/conversations.list', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const data = await response.json()

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`)
  }

  return data.channels.map((channel: any) => ({
    id: channel.id,
    name: channel.name,
    isPrivate: channel.is_private,
  }))
}
```

### API Routes

```typescript
// apps/web/app/api/plugins/slack/connect/route.ts

import { NextResponse } from 'next/server'
import { getSlackOAuthUrl } from '@quackback/integrations/plugins/slack'
import { requireTenantRole } from '@/lib/auth'
import { signState } from '@/lib/oauth-state'

export async function GET() {
  const { member } = await requireTenantRole(['owner', 'admin'])

  const state = signState({
    memberId: member.id,
    timestamp: Date.now(),
  })

  const redirectUri = `${process.env.NEXT_PUBLIC_ROOT_URL}/api/plugins/slack/callback`
  const slackUrl = getSlackOAuthUrl(state, redirectUri)

  // Set state in secure cookie
  const response = NextResponse.redirect(slackUrl)
  response.cookies.set('slack_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
  })

  return response
}
```

```typescript
// apps/web/app/api/plugins/slack/callback/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { exchangeSlackCode } from '@quackback/integrations/plugins/slack'
import { verifyState } from '@/lib/oauth-state'
import { encrypt } from '@/lib/crypto'
import { db } from '@quackback/db'
import { pluginInstallations, pluginSubscriptions } from '@quackback/db/schema'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  if (!code || !state) {
    return NextResponse.json({ error: 'Missing code or state' }, { status: 400 })
  }

  // Verify state
  const cookieState = request.cookies.get('slack_oauth_state')?.value
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const stateData = verifyState(state)
  if (!stateData) {
    return NextResponse.json({ error: 'Invalid state signature' }, { status: 400 })
  }

  try {
    // Exchange code for token
    const redirectUri = `${process.env.NEXT_PUBLIC_ROOT_URL}/api/plugins/slack/callback`
    const { accessToken, teamId, teamName } = await exchangeSlackCode(code, redirectUri)

    // Encrypt credentials
    const credentials = {
      type: 'oauth' as const,
      oauth: {
        accessToken,
        expiresAt: null, // Slack tokens don't expire
      },
    }
    const encryptedCredentials = encrypt(JSON.stringify(credentials), process.env.ENCRYPTION_KEY!)

    // Create or update installation
    const [installation] = await db
      .insert(pluginInstallations)
      .values({
        pluginId: 'slack',
        credentialsEncrypted: encryptedCredentials,
        config: {
          settings: {
            teamId,
            teamName,
          },
        },
        status: 'active',
        installedByMemberId: stateData.memberId,
      })
      .onConflictDoUpdate({
        target: [pluginInstallations.pluginId],
        set: {
          credentialsEncrypted: encryptedCredentials,
          status: 'active',
        },
      })
      .returning()

    // Subscribe to default events
    await db.insert(pluginSubscriptions).values([
      { installationId: installation.id, eventType: 'post.created', enabled: true },
      { installationId: installation.id, eventType: 'post.status_changed', enabled: true },
      { installationId: installation.id, eventType: 'comment.created', enabled: true },
    ])

    // Redirect to settings page
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_ROOT_URL}/admin/plugins/slack?success=true`)
  } catch (error) {
    console.error('Slack OAuth error:', error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_ROOT_URL}/admin/plugins/slack?error=oauth_failed`
    )
  }
}
```

```typescript
// apps/web/app/api/plugins/slack/channels/route.ts

import { NextResponse } from 'next/server'
import { listSlackChannels } from '@quackback/integrations/plugins/slack'
import { withApiHandler } from '@/lib/api-handler'
import { db } from '@quackback/db'
import { pluginInstallations } from '@quackback/db/schema'
import { decrypt } from '@/lib/crypto'
import { eq } from 'drizzle-orm'

export const GET = withApiHandler(
  async () => {
    // Get Slack installation
    const [installation] = await db
      .select()
      .from(pluginInstallations)
      .where(eq(pluginInstallations.pluginId, 'slack'))

    if (!installation) {
      return NextResponse.json({ error: 'Slack not connected' }, { status: 404 })
    }

    // Decrypt credentials
    const credentials = JSON.parse(
      decrypt(installation.credentialsEncrypted!, process.env.ENCRYPTION_KEY!)
    )

    // List channels
    const channels = await listSlackChannels(credentials.oauth.accessToken)

    return NextResponse.json({ channels })
  },
  { roles: ['owner', 'admin'] }
)
```

---

## Example 2: Webhook Integration (Simple)

### Plugin Implementation

```typescript
// packages/integrations/src/plugins/webhook/plugin.ts

import { createHmac } from 'crypto'
import { ok, err, type Result } from '@quackback/domain'
import type {
  Plugin,
  PluginConfig,
  PluginCredentials,
  PluginResult,
  PluginError,
  DomainEvent,
} from '../../base/plugin'

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
    const customHeaders = (config.settings.headers as Record<string, string>) || {}
    const retryAttempts = (config.settings.retryAttempts as number) || 3

    // Filter by event type if specified
    const enabledEvents = config.settings.events as string[] | undefined
    if (enabledEvents && !enabledEvents.includes(event.type)) {
      return ok({
        success: true,
        message: `Event ${event.type} not enabled for this webhook`,
      })
    }

    // Retry logic
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      const result = await this.deliver(event, url, secret, customHeaders)

      if (result.success) {
        return ok(result.value)
      }

      if (!this.shouldRetry(result.error, attempt, retryAttempts)) {
        return result
      }

      lastError = new Error(result.error.message)

      // Exponential backoff: 5s, 25s, 125s
      if (attempt < retryAttempts) {
        const backoff = 5000 * Math.pow(5, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, backoff))
      }
    }

    return err({
      code: 'WEBHOOK_EXHAUSTED',
      message: `Failed after ${retryAttempts} attempts: ${lastError?.message}`,
    })
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

      // Security: block localhost and private IPs
      if (this.isPrivateUrl(parsed)) {
        return err({
          code: 'INVALID_URL',
          message: 'Cannot use localhost or private IP addresses',
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

  private async deliver(
    event: DomainEvent,
    url: string,
    secret: string,
    customHeaders: Record<string, string>
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
          'X-Quackback-Timestamp': event.timestamp,
          ...customHeaders,
        },
        body: payload,
        signal: AbortSignal.timeout(10000), // 10s timeout
      })

      if (!response.ok) {
        // 410 Gone = endpoint explicitly says stop sending
        if (response.status === 410) {
          return err({
            code: 'WEBHOOK_GONE',
            message: 'Endpoint returned 410 Gone - disable this webhook',
          })
        }

        return err({
          code: 'WEBHOOK_HTTP_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        })
      }

      return ok({
        success: true,
        message: `Webhook delivered to ${url}`,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return err({
          code: 'WEBHOOK_TIMEOUT',
          message: 'Request timed out after 10 seconds',
        })
      }

      return err({
        code: 'WEBHOOK_DELIVERY_FAILED',
        message: error instanceof Error ? error.message : 'Delivery failed',
      })
    }
  }

  private shouldRetry(error: PluginError, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts) return false

    // Don't retry these
    if (error.code === 'WEBHOOK_GONE') return false
    if (error.code === 'INVALID_URL') return false

    // Retry network errors and 5xx
    return true
  }

  private isPrivateUrl(url: URL): boolean {
    const hostname = url.hostname.toLowerCase()

    // Localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true

    // Private IP ranges
    if (hostname.startsWith('192.168.')) return true
    if (hostname.startsWith('10.')) return true
    if (hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) return true

    // Link-local
    if (hostname.startsWith('169.254.')) return true

    return false
  }
}
```

### API Route (Simple Setup)

```typescript
// apps/web/app/api/plugins/webhook/route.ts

import { NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api-handler'
import { db } from '@quackback/db'
import { pluginInstallations, pluginSubscriptions } from '@quackback/db/schema'
import { encrypt } from '@/lib/crypto'
import { randomBytes } from 'crypto'

export const POST = withApiHandler(
  async (request) => {
    const body = await request.json()
    const { url, events, headers } = body

    // Generate webhook secret
    const secret = `whsec_${randomBytes(32).toString('base64url')}`

    // Encrypt credentials
    const credentials = {
      type: 'webhook_secret' as const,
      webhookSecret: { secret },
    }
    const encryptedCredentials = encrypt(JSON.stringify(credentials), process.env.ENCRYPTION_KEY!)

    // Create installation
    const [installation] = await db
      .insert(pluginInstallations)
      .values({
        pluginId: 'webhook',
        credentialsEncrypted: encryptedCredentials,
        config: {
          settings: { url, events, headers },
        },
        status: 'active',
      })
      .returning()

    // Subscribe to selected events
    await db.insert(pluginSubscriptions).values(
      events.map((eventType: string) => ({
        installationId: installation.id,
        eventType,
        enabled: true,
      }))
    )

    return NextResponse.json({
      installation: {
        id: installation.id,
        secret, // Return secret ONCE for user to store
        url,
        events,
      },
    })
  },
  { roles: ['owner', 'admin'] }
)
```

---

## Example 3: GitHub Integration (OAuth)

### Plugin Implementation

```typescript
// packages/integrations/src/plugins/github/plugin.ts

import { Octokit } from '@octokit/rest'
import { ok, err, type Result } from '@quackback/domain'
import type {
  Plugin,
  PluginConfig,
  PluginCredentials,
  PluginResult,
  PluginError,
  DomainEvent,
} from '../../base/plugin'

export class GitHubPlugin implements Plugin {
  readonly id = 'github'
  readonly name = 'GitHub'
  readonly supportedEvents = [
    'post.created',
    'post.status_changed',
    'post.deleted',
  ] as const

  async handle(
    event: DomainEvent,
    config: PluginConfig,
    credentials: PluginCredentials
  ): Promise<Result<PluginResult, PluginError>> {
    if (credentials.type !== 'oauth') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'GitHub requires OAuth credentials',
      })
    }

    const octokit = new Octokit({ auth: credentials.oauth.accessToken })
    const repository = config.settings.repository as string
    const [owner, repo] = repository.split('/')

    try {
      switch (event.type) {
        case 'post.created':
          return await this.createIssue(event, owner, repo, octokit, config)
        case 'post.status_changed':
          return await this.updateIssueLabels(event, owner, repo, octokit, config)
        case 'post.deleted':
          return await this.closeIssue(event, owner, repo, octokit)
        default:
          return ok({ success: true, message: 'Event ignored' })
      }
    } catch (error) {
      return err({
        code: 'GITHUB_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    const repository = config.settings.repository as string

    if (!repository) {
      return err({
        code: 'MISSING_REPOSITORY',
        message: 'repository is required (format: owner/repo)',
      })
    }

    if (!repository.includes('/') || repository.split('/').length !== 2) {
      return err({
        code: 'INVALID_REPOSITORY',
        message: 'repository must be in format: owner/repo',
      })
    }

    return ok(undefined)
  }

  private async createIssue(
    event: DomainEvent,
    owner: string,
    repo: string,
    octokit: Octokit,
    config: PluginConfig
  ): Promise<Result<PluginResult, PluginError>> {
    const { post } = event.data

    // Build issue body with link back to Quackback
    const body = [
      post.description,
      '',
      '---',
      `*This issue was automatically created from [Quackback](${post.url})*`,
      `**Board:** ${post.boardSlug}`,
      `**Votes:** ${post.voteCount || 0}`,
    ].join('\n')

    const labels = this.buildLabels(config, post)

    const { data: issue } = await octokit.rest.issues.create({
      owner,
      repo,
      title: post.title,
      body,
      labels,
    })

    return ok({
      success: true,
      externalEntity: {
        id: issue.number.toString(),
        url: issue.html_url,
        metadata: { issueNumber: issue.number },
      },
      message: `Created GitHub issue #${issue.number}`,
    })
  }

  private async updateIssueLabels(
    event: DomainEvent,
    owner: string,
    repo: string,
    octokit: Octokit,
    config: PluginConfig
  ): Promise<Result<PluginResult, PluginError>> {
    const { post, newStatus, externalEntityId } = event.data

    if (!externalEntityId) {
      return ok({ success: true, message: 'No linked GitHub issue' })
    }

    const issueNumber = parseInt(externalEntityId, 10)
    const labels = this.buildLabels(config, { ...post, status: newStatus })

    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      labels,
    })

    return ok({
      success: true,
      message: `Updated GitHub issue #${issueNumber} labels`,
    })
  }

  private async closeIssue(
    event: DomainEvent,
    owner: string,
    repo: string,
    octokit: Octokit
  ): Promise<Result<PluginResult, PluginError>> {
    const { externalEntityId } = event.data

    if (!externalEntityId) {
      return ok({ success: true, message: 'No linked GitHub issue' })
    }

    const issueNumber = parseInt(externalEntityId, 10)

    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: 'closed',
    })

    return ok({
      success: true,
      message: `Closed GitHub issue #${issueNumber}`,
    })
  }

  private buildLabels(config: PluginConfig, post: any): string[] {
    const labels: string[] = ['quackback']

    // Add board label
    if (post.boardSlug) {
      labels.push(`board:${post.boardSlug}`)
    }

    // Add status label
    if (post.status) {
      labels.push(`status:${post.status.toLowerCase()}`)
    }

    // Custom label mapping from config
    const labelMapping = config.settings.labelMapping as Record<string, string> | undefined
    if (labelMapping && post.status) {
      const customLabel = labelMapping[post.status]
      if (customLabel) {
        labels.push(customLabel)
      }
    }

    return labels
  }
}
```

### OAuth Helpers

```typescript
// packages/integrations/src/plugins/github/oauth.ts

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!

export function getGitHubOAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    scope: 'repo',
  })

  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

export async function exchangeGitHubCode(
  code: string
): Promise<{
  accessToken: string
}> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  })

  const data = await response.json()

  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description}`)
  }

  return {
    accessToken: data.access_token,
  }
}

export async function listGitHubRepositories(accessToken: string): Promise<
  Array<{
    fullName: string
    description: string | null
    private: boolean
  }>
> {
  const response = await fetch('https://api.github.com/user/repos?per_page=100', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  })

  const repos = await response.json()

  return repos.map((repo: any) => ({
    fullName: repo.full_name,
    description: repo.description,
    private: repo.private,
  }))
}
```

---

## Example 4: Discord Integration (Webhook-based)

### Plugin Implementation

```typescript
// packages/integrations/src/plugins/discord/plugin.ts

import { ok, err, type Result } from '@quackback/domain'
import type {
  Plugin,
  PluginConfig,
  PluginCredentials,
  PluginResult,
  PluginError,
  DomainEvent,
} from '../../base/plugin'

export class DiscordPlugin implements Plugin {
  readonly id = 'discord'
  readonly name = 'Discord'
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
    // Discord uses webhook URLs, no credentials needed
    if (credentials.type !== 'none') {
      return err({
        code: 'INVALID_CREDENTIALS',
        message: 'Discord uses webhook URL, no credentials needed',
      })
    }

    const webhookUrl = config.settings.webhookUrl as string

    try {
      const embed = this.buildEmbed(event, config)

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      })

      if (!response.ok) {
        return err({
          code: 'DISCORD_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        })
      }

      return ok({
        success: true,
        message: 'Posted to Discord',
      })
    } catch (error) {
      return err({
        code: 'DISCORD_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }

  async validateConfig(config: PluginConfig): Promise<Result<void, PluginError>> {
    const webhookUrl = config.settings.webhookUrl as string

    if (!webhookUrl) {
      return err({
        code: 'MISSING_WEBHOOK_URL',
        message: 'webhookUrl is required',
      })
    }

    if (!webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
      return err({
        code: 'INVALID_WEBHOOK_URL',
        message: 'Must be a valid Discord webhook URL',
      })
    }

    return ok(undefined)
  }

  private buildEmbed(event: DomainEvent, config: PluginConfig) {
    switch (event.type) {
      case 'post.created':
        return this.formatPostCreated(event)
      case 'post.status_changed':
        return this.formatStatusChanged(event)
      case 'comment.created':
        return this.formatCommentCreated(event)
      case 'changelog.published':
        return this.formatChangelog(event)
      default:
        return { title: event.type, description: 'Event occurred' }
    }
  }

  private formatPostCreated(event: DomainEvent) {
    const { post } = event.data
    const author = event.actor.email || 'Someone'

    return {
      title: `📬 New post: ${post.title}`,
      description: this.truncate(post.description, 300),
      url: post.url,
      color: 0x5865f2, // Discord blurple
      author: {
        name: author,
      },
      fields: [
        {
          name: 'Board',
          value: post.boardSlug,
          inline: true,
        },
        {
          name: 'Votes',
          value: (post.voteCount || 0).toString(),
          inline: true,
        },
      ],
      timestamp: event.timestamp,
    }
  }

  private formatStatusChanged(event: DomainEvent) {
    const { post, previousStatus, newStatus } = event.data

    return {
      title: `📌 Status Updated: ${post.title}`,
      description: `${previousStatus} → **${newStatus}**`,
      url: post.url,
      color: 0xfee75c, // Yellow
      timestamp: event.timestamp,
    }
  }

  private formatCommentCreated(event: DomainEvent) {
    const { comment, post } = event.data
    const author = event.actor.email || 'Someone'

    return {
      title: `💬 New comment on: ${post.title}`,
      description: this.truncate(comment.content, 300),
      url: post.url,
      color: 0x57f287, // Green
      author: {
        name: author,
      },
      timestamp: event.timestamp,
    }
  }

  private formatChangelog(event: DomainEvent) {
    const { changelog } = event.data

    return {
      title: `📰 New changelog: ${changelog.title}`,
      description: this.truncate(changelog.content, 300),
      url: changelog.url,
      color: 0xed4245, // Red
      timestamp: event.timestamp,
    }
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return ''
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }
}
```

---

## Example 5: Linear Integration (API Key)

### Plugin Implementation

```typescript
// packages/integrations/src/plugins/linear/plugin.ts

import { LinearClient } from '@linear/sdk'
import { ok, err, type Result } from '@quackback/domain'
import type {
  Plugin,
  PluginConfig,
  PluginCredentials,
  PluginResult,
  PluginError,
  DomainEvent,
} from '../../base/plugin'

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

    const client = new LinearClient({ apiKey: credentials.apiKey.key })
    const teamId = config.settings.teamId as string

    try {
      switch (event.type) {
        case 'post.created':
          return await this.createIssue(event, teamId, client, config)
        case 'post.status_changed':
          return await this.updateIssueState(event, teamId, client, config)
        default:
          return ok({ success: true, message: 'Event ignored' })
      }
    } catch (error) {
      return err({
        code: 'LINEAR_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Request failed',
      })
    }
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

  private async createIssue(
    event: DomainEvent,
    teamId: string,
    client: LinearClient,
    config: PluginConfig
  ): Promise<Result<PluginResult, PluginError>> {
    const { post } = event.data

    // Build description with link back
    const description = [
      post.description,
      '',
      '---',
      `[View in Quackback](${post.url})`,
      `**Votes:** ${post.voteCount || 0}`,
    ].join('\n')

    const labels = await this.getLabels(client, config, post)
    const priority = this.calculatePriority(post.voteCount || 0)

    const issue = await client.createIssue({
      teamId,
      title: post.title,
      description,
      labelIds: labels,
      priority,
    })

    const issueData = await issue.issue

    if (!issueData) {
      return err({
        code: 'LINEAR_CREATE_FAILED',
        message: 'Failed to create Linear issue',
      })
    }

    return ok({
      success: true,
      externalEntity: {
        id: issueData.id,
        url: issueData.url,
        metadata: {
          identifier: issueData.identifier, // e.g., "ENG-123"
        },
      },
      message: `Created Linear issue ${issueData.identifier}`,
    })
  }

  private async updateIssueState(
    event: DomainEvent,
    teamId: string,
    client: LinearClient,
    config: PluginConfig
  ): Promise<Result<PluginResult, PluginError>> {
    const { newStatus, externalEntityId } = event.data

    if (!externalEntityId) {
      return ok({ success: true, message: 'No linked Linear issue' })
    }

    // Get workflow state ID from status mapping
    const stateMapping = config.settings.stateMapping as Record<string, string> | undefined
    const stateId = stateMapping?.[newStatus]

    if (!stateId) {
      return ok({ success: true, message: `No state mapping for ${newStatus}` })
    }

    await client.updateIssue(externalEntityId, {
      stateId,
    })

    return ok({
      success: true,
      message: `Updated Linear issue state to ${newStatus}`,
    })
  }

  private async getLabels(
    client: LinearClient,
    config: PluginConfig,
    post: any
  ): Promise<string[]> {
    // Get or create "Quackback" label
    const labels = await client.issueLabels()
    const quackbackLabel = labels.nodes.find(l => l.name === 'Quackback')

    if (quackbackLabel) {
      return [quackbackLabel.id]
    }

    // Create label if it doesn't exist
    const createResult = await client.createIssueLabel({
      name: 'Quackback',
      color: '#5865f2',
    })

    const newLabel = await createResult.issueLabel
    return newLabel ? [newLabel.id] : []
  }

  private calculatePriority(voteCount: number): number {
    // Linear priority: 0 = None, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
    if (voteCount >= 50) return 1 // Urgent
    if (voteCount >= 20) return 2 // High
    if (voteCount >= 5) return 3 // Medium
    return 4 // Low
  }
}
```

---

## Plugin Registration

```typescript
// apps/web/lib/plugins/register.ts

import { pluginRegistry } from '@quackback/integrations'

// Core plugins
import { SlackPlugin } from '@quackback/integrations/plugins/slack'
import { WebhookPlugin } from '@quackback/integrations/plugins/webhook'
import { GitHubPlugin } from '@quackback/integrations/plugins/github'
import { DiscordPlugin } from '@quackback/integrations/plugins/discord'
import { LinearPlugin } from '@quackback/integrations/plugins/linear'

export function registerPlugins() {
  console.log('Registering plugins...')

  pluginRegistry.register(new SlackPlugin())
  pluginRegistry.register(new WebhookPlugin())
  pluginRegistry.register(new GitHubPlugin())
  pluginRegistry.register(new DiscordPlugin())
  pluginRegistry.register(new LinearPlugin())

  const plugins = pluginRegistry.list()
  console.log(`✅ Registered ${plugins.length} plugins:`, plugins.map(p => p.id).join(', '))
}
```

```typescript
// apps/web/instrumentation.ts (called on server startup)

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerPlugins } = await import('./lib/plugins/register')
    registerPlugins()
  }
}
```

---

## Usage in Event Processor

```typescript
// packages/jobs/src/processors/event-processor.ts

import { PluginExecutor, pluginRegistry } from '@quackback/integrations'
import { db } from '@quackback/db'
import type { DomainEvent } from '@quackback/domain'

export async function processEvent(event: DomainEvent) {
  const executor = new PluginExecutor(pluginRegistry, db)

  console.log(`Processing event ${event.type} (${event.id})`)

  const summary = await executor.executeForEvent(event, event.workspaceId)

  console.log(
    `✅ Event processed: ${summary.successful}/${summary.totalPlugins} plugins succeeded`
  )

  if (summary.failed > 0) {
    console.error(`❌ ${summary.failed} plugins failed:`, summary.results.filter(r => !r.success))
  }

  return summary
}
```

---

## Database Records Example

After installing Slack:

```sql
-- plugin_installations
INSERT INTO plugin_installations (
  id,
  plugin_id,
  credentials_encrypted,
  config,
  status,
  installed_at
) VALUES (
  'plugin_01h455vb4pex5vsknk084sn02q',
  'slack',
  'encrypted_oauth_token_here',
  '{"settings":{"teamId":"T123ABC","teamName":"My Team"}}',
  'active',
  NOW()
);

-- plugin_subscriptions
INSERT INTO plugin_subscriptions (
  id,
  installation_id,
  event_type,
  enabled
) VALUES
  ('sub_01h455vb4pex5vsknk084sn123', 'plugin_01h455vb4pex5vsknk084sn02q', 'post.created', true),
  ('sub_01h455vb4pex5vsknk084sn124', 'plugin_01h455vb4pex5vsknk084sn02q', 'post.status_changed', true),
  ('sub_01h455vb4pex5vsknk084sn125', 'plugin_01h455vb4pex5vsknk084sn02q', 'comment.created', true);
```

After webhook fires:

```sql
-- plugin_executions
INSERT INTO plugin_executions (
  id,
  installation_id,
  event_id,
  event_type,
  status,
  duration_ms,
  external_entity_id,
  external_entity_url,
  created_at
) VALUES (
  'exec_01h455vb4pex5vsknk084sn789',
  'plugin_01h455vb4pex5vsknk084sn02q',
  '550e8400-e29b-41d4-a716-446655440000',
  'post.created',
  'success',
  342,
  '1234567890.123456',
  'slack://channel?id=C123ABC&message=1234567890.123456',
  NOW()
);
```

---

This shows complete, production-ready implementations of 5 popular integrations using the minimal plugin interface!
