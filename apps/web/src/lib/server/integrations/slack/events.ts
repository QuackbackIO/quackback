/**
 * Slack Events API handler.
 *
 * Receives real-time message events from monitored Slack channels
 * and ingests them as raw feedback items through the existing pipeline.
 */

import { WebClient } from '@slack/web-api'
import { db, eq, and, feedbackSources, integrations, slackChannelMonitors } from '@/lib/server/db'
import { getPlatformCredentials } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { decryptSecrets } from '../encryption'
import { ingestRawFeedback } from '@/lib/server/domains/feedback/ingestion/feedback-ingest.service'
import { verifySlackSignature } from './verify'
import type { FeedbackSourceId, IntegrationId } from '@quackback/ids'

interface SlackMessageEvent {
  type?: string
  subtype?: string
  bot_id?: string
  channel_type?: string
  channel?: string
  user?: string
  text?: string
  ts?: string
}

// In-memory LRU dedup for Slack event retries.
// Slack retries up to 3 times if we don't respond within 3 seconds.
const SEEN_EVENTS = new Map<string, number>()
const SEEN_EVENTS_MAX = 10_000
const SEEN_EVENTS_TTL_MS = 5 * 60 * 1000

// Simple user info cache to avoid hammering Slack API for repeat posters.
const USER_CACHE = new Map<string, { name: string; email?: string; ts: number }>()
const USER_CACHE_TTL_MS = 10 * 60 * 1000

function pruneMap(map: Map<string, number | { ts: number }>, maxSize: number, ttlMs: number) {
  if (map.size <= maxSize) return
  const now = Date.now()
  for (const [key, val] of map) {
    const ts = typeof val === 'number' ? val : val?.ts
    if (now - ts > ttlMs) map.delete(key)
  }
  // If still over, remove oldest entries
  if (map.size > maxSize) {
    const excess = map.size - maxSize
    let i = 0
    for (const key of map.keys()) {
      if (i++ >= excess) break
      map.delete(key)
    }
  }
}

/**
 * Main entry point for Slack Events API requests.
 * POST /api/integrations/slack/events
 */
export async function handleSlackEvents(request: Request): Promise<Response> {
  const body = await request.text()

  // Verify signature first — all Slack requests (including url_verification) are signed
  const [credentials, integration] = await Promise.all([
    getPlatformCredentials('slack'),
    db.query.integrations.findFirst({
      where: and(eq(integrations.integrationType, 'slack'), eq(integrations.status, 'active')),
      columns: { id: true, secrets: true },
    }),
  ])

  if (!credentials?.signingSecret) {
    console.error('[SlackEvents] Signing secret not configured')
    return new Response('Slack signing secret not configured', { status: 500 })
  }

  const sigResult = verifySlackSignature(
    body,
    request.headers.get('X-Slack-Request-Timestamp'),
    request.headers.get('X-Slack-Signature'),
    credentials.signingSecret
  )
  if (sigResult !== true) return sigResult

  let payload: {
    type: string
    challenge?: string
    event_id?: string
    team_id?: string
    event?: SlackMessageEvent
  }
  try {
    payload = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // URL verification challenge (Slack app setup handshake)
  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge })
  }

  if (!integration?.secrets) {
    return new Response('Slack integration not connected', { status: 400 })
  }
  if (payload.type !== 'event_callback') {
    return new Response('', { status: 200 })
  }

  // Deduplicate by event_id (Slack retries)
  const eventId = payload.event_id
  if (eventId) {
    if (SEEN_EVENTS.has(eventId)) {
      return new Response('', { status: 200 })
    }
    SEEN_EVENTS.set(eventId, Date.now())
    pruneMap(SEEN_EVENTS, SEEN_EVENTS_MAX, SEEN_EVENTS_TTL_MS)
  }

  const event = payload.event
  if (event?.type === 'message') {
    const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
    // Fire-and-forget to stay within 3-second Slack deadline
    void handleChannelMessage(
      event,
      payload.team_id ?? '',
      integration.id as IntegrationId,
      secrets.accessToken
    ).catch((err) => {
      console.error('[SlackEvents] Failed to handle message:', err)
    })
  }

  return new Response('', { status: 200 })
}

async function handleChannelMessage(
  event: SlackMessageEvent,
  teamId: string,
  integrationId: IntegrationId,
  accessToken: string
): Promise<void> {
  // Only ingest normal user messages (no subtype = regular message)
  if (event.subtype) return
  if (event.bot_id) return
  if (event.channel_type !== 'channel' && event.channel_type !== 'group') return

  const channelId = event.channel
  if (!channelId) return

  // Check if this channel is monitored
  const monitor = await db.query.slackChannelMonitors.findFirst({
    where: and(
      eq(slackChannelMonitors.integrationId, integrationId),
      eq(slackChannelMonitors.channelId, channelId),
      eq(slackChannelMonitors.enabled, true)
    ),
  })

  if (!monitor) return

  // Find the Slack feedback source
  const source = await db.query.feedbackSources.findFirst({
    where: and(
      eq(feedbackSources.sourceType, 'slack'),
      eq(feedbackSources.integrationId, integrationId)
    ),
    columns: { id: true },
  })

  if (!source) {
    console.error('[SlackEvents] No feedback source found for integration', integrationId)
    return
  }

  // Resolve user display name and email
  const userInfo = await resolveSlackUser(accessToken, event.user ?? '')

  // Fetch workspace-scoped permalink (falls back to generic slack.com URL)
  const messageTs = event.ts ?? ''
  let permalink: string
  try {
    const client = new WebClient(accessToken)
    const res = await client.chat.getPermalink({ channel: channelId, message_ts: messageTs })
    permalink = res.permalink!
  } catch {
    const tsNoDot = messageTs.replace('.', '')
    permalink = `https://slack.com/archives/${channelId}/p${tsNoDot}`
  }

  await ingestRawFeedback(
    {
      externalId: `${teamId}:${channelId}:${messageTs}`,
      sourceCreatedAt: new Date(parseFloat(messageTs) * 1000),
      externalUrl: permalink,
      author: {
        name: userInfo.name,
        ...(userInfo.email && { email: userInfo.email }),
        externalUserId: event.user ?? '',
      },
      content: {
        subject: '', // Quality gate will generate the title
        text: event.text || '',
      },
      contextEnvelope: {
        sourceChannel: { id: channelId, name: monitor.channelName },
        metadata: {
          messageTs,
          teamId,
          boardId: monitor.boardId,
          monitorId: monitor.id,
          ingestionMode: 'channel_monitor',
        },
      },
    },
    {
      sourceId: source.id as FeedbackSourceId,
      sourceType: 'slack',
    }
  )
}

async function resolveSlackUser(
  accessToken: string,
  userId: string
): Promise<{ name: string; email?: string }> {
  if (!userId) return { name: 'Unknown' }

  const cached = USER_CACHE.get(userId)
  if (cached && Date.now() - cached.ts < USER_CACHE_TTL_MS) {
    return { name: cached.name, email: cached.email }
  }

  try {
    const client = new WebClient(accessToken)
    const result = await client.users.info({ user: userId })
    const name =
      result.user?.profile?.display_name ||
      result.user?.profile?.real_name ||
      result.user?.name ||
      userId
    const email = result.user?.profile?.email || undefined
    USER_CACHE.set(userId, { name, email, ts: Date.now() })
    pruneMap(USER_CACHE, 1000, USER_CACHE_TTL_MS)
    return { name, email }
  } catch (error) {
    console.warn(`[SlackEvents] Failed to resolve user ${userId}:`, error)
    return { name: userId }
  }
}
