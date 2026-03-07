/**
 * Slack interactivity handler.
 *
 * Handles message shortcuts ("Send to Quackback") and view submissions.
 */

import { WebClient } from '@slack/web-api'
import { db, eq, and, feedbackSources, integrations } from '@/lib/server/db'
import { getPlatformCredentials } from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { getBaseUrl } from '@/lib/server/config'
import { decryptSecrets } from '../encryption'
import { ingestRawFeedback } from '@/lib/server/domains/feedback/ingestion/feedback-ingest.service'
import { verifySlackSignature } from './verify'
import type { FeedbackSourceId, IntegrationId } from '@quackback/ids'

const CALLBACK_ID_MESSAGE_ACTION = 'quackback_send_feedback'
const CALLBACK_ID_MODAL = 'quackback_send_feedback_modal'

/**
 * Main entry point for Slack interactivity requests.
 * POST /api/integrations/slack/interact
 */
export async function handleSlackInteractivity(request: Request): Promise<Response> {
  const body = await request.text()

  // Fetch credentials and integration record in parallel (independent queries)
  const [credentials, integration] = await Promise.all([
    getPlatformCredentials('slack'),
    db.query.integrations.findFirst({
      where: and(eq(integrations.integrationType, 'slack'), eq(integrations.status, 'active')),
      columns: { id: true, secrets: true },
    }),
  ])

  if (!credentials?.signingSecret) {
    console.error('[Slack] Signing secret not configured')
    return new Response('Slack signing secret not configured', { status: 500 })
  }

  // Verify signature
  const sigResult = verifySlackSignature(
    body,
    request.headers.get('X-Slack-Request-Timestamp'),
    request.headers.get('X-Slack-Signature'),
    credentials.signingSecret
  )
  if (sigResult !== true) return sigResult

  // Parse the payload from form-urlencoded body
  const params = new URLSearchParams(body)
  const rawPayload = params.get('payload')
  if (!rawPayload) {
    return new Response('Missing payload', { status: 400 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    return new Response('Invalid payload JSON', { status: 400 })
  }

  if (!integration?.secrets) {
    return new Response('Slack integration not connected', { status: 400 })
  }

  const secrets = decryptSecrets<{ accessToken: string }>(integration.secrets)
  const client = new WebClient(secrets.accessToken)

  // Dispatch based on payload type
  if (payload.type === 'message_action' && payload.callback_id === CALLBACK_ID_MESSAGE_ACTION) {
    return handleMessageAction(payload, client)
  }

  if (payload.type === 'view_submission' && payload.view?.callback_id === CALLBACK_ID_MODAL) {
    return handleViewSubmission(payload, client, integration.id as IntegrationId)
  }

  return new Response('', { status: 200 })
}

/**
 * Handle a message shortcut action - opens the feedback modal.
 */
async function handleMessageAction(payload: any, client: WebClient): Promise<Response> {
  const messageText = payload.message?.text || ''
  const channelName = payload.channel?.name || 'unknown'
  const channelId = payload.channel?.id || ''
  const messageTs = payload.message?.ts || ''
  const teamId = payload.team?.id || ''

  // Store context needed for submission in private_metadata
  const privateMetadata = JSON.stringify({
    channelId,
    channelName,
    messageTs,
    teamId,
  })

  // Only field: the feedback content. Title, board, status, and author
  // are all handled downstream — AI generates suggestions, admin refines
  // when creating the post from the Incoming tab.
  const blocks: any[] = [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `From *#${channelName}*` }],
    },
    {
      type: 'input',
      block_id: 'details_block',
      label: { type: 'plain_text', text: 'Feedback' },
      element: {
        type: 'plain_text_input',
        action_id: 'details',
        multiline: true,
        initial_value: messageText,
        placeholder: { type: 'plain_text', text: 'Edit or add context before sending' },
      },
    },
  ]

  try {
    await client.views.open({
      trigger_id: payload.trigger_id,
      view: {
        type: 'modal',
        callback_id: CALLBACK_ID_MODAL,
        private_metadata: privateMetadata,
        title: { type: 'plain_text', text: 'Send to Quackback' },
        submit: { type: 'plain_text', text: 'Send' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks,
      },
    })
  } catch (error) {
    console.error('[Slack] Failed to open modal:', error)
  }

  // Must return 200 immediately for message actions
  return new Response('', { status: 200 })
}

/**
 * Handle modal submission - ingest feedback and post confirmation.
 */
async function handleViewSubmission(
  payload: any,
  client: WebClient,
  integrationId: IntegrationId
): Promise<Response> {
  const values = payload.view?.state?.values || {}
  const details = values.details_block?.details?.value || ''

  if (!details.trim()) {
    return new Response('', { status: 200 })
  }

  const metadata = JSON.parse(payload.view?.private_metadata || '{}')
  const { channelId, channelName, messageTs, teamId } = metadata

  // Find the Slack feedback source
  const source = await db.query.feedbackSources.findFirst({
    where: and(
      eq(feedbackSources.sourceType, 'slack'),
      eq(feedbackSources.integrationId, integrationId)
    ),
    columns: { id: true },
  })

  if (!source) {
    console.error('[Slack] No feedback source found for integration', integrationId)
    return new Response('', { status: 200 })
  }

  const userId = payload.user?.id || ''
  const userName = payload.user?.name || payload.user?.username || ''

  // Fire-and-forget: ingest + confirmation
  void (async () => {
    try {
      await ingestRawFeedback(
        {
          externalId: `${teamId}:${channelId}:${messageTs}`,
          sourceCreatedAt: messageTs ? new Date(parseFloat(messageTs) * 1000) : new Date(),
          author: {
            name: userName,
            externalUserId: userId,
          },
          content: {
            subject: '',
            text: details,
          },
          contextEnvelope: {
            sourceChannel: { id: channelId, name: channelName },
            metadata: { messageTs, teamId, ingestionMode: 'shortcut' },
          },
        },
        {
          sourceId: source.id as FeedbackSourceId,
          sourceType: 'slack',
        }
      )

      // Post ephemeral confirmation in channel, fall back to DM if bot isn't a member
      if (channelId) {
        const baseUrl = getBaseUrl()
        const incomingUrl = `${baseUrl}/admin/feedback/incoming`
        const snippet = details.length > 80 ? details.slice(0, 77) + '...' : details
        const fallbackText = `Feedback sent to Quackback: ${snippet}`
        const confirmationBlocks = [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Feedback sent to Quackback*\n${snippet}`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `From *#${channelName}* · <${incomingUrl}|View in Quackback>`,
              },
            ],
          },
        ]

        try {
          await client.chat.postEphemeral({
            channel: channelId,
            user: userId,
            text: fallbackText,
            blocks: confirmationBlocks,
          })
        } catch {
          // Bot not in channel - send DM instead
          await client.chat.postMessage({
            channel: userId,
            text: fallbackText,
            blocks: confirmationBlocks,
            unfurl_links: false,
          })
        }
      }
    } catch (error) {
      console.error('[Slack] Failed to ingest feedback:', error)
    }
  })()

  // Return 200 immediately to close the modal
  return new Response('', { status: 200 })
}
