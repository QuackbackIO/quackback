import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { revokesSlackInstallation } from './revocation'
import { toolPermissions } from '@/lib/server/domains/assistant/tool-permissions'
import { createHash } from 'node:crypto'
import { WebClient } from '@slack/web-api'
import type { ChatStopStreamArguments } from '@slack/web-api'
type KnownBlock = NonNullable<ChatStopStreamArguments['blocks']>[number]
import { generateId, isTypeId, type AssistantPendingActionId } from '@quackback/ids'
import { db, integrations, assistantEvents, slackUserLinks, eq, and, sql } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import type { ClaimedJob } from '@/lib/server/jobs/job-queue'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  getAssistantRuntimeConfig,
  updateAssistantConfig,
} from '@/lib/server/domains/settings/settings.assistant'
import { hasEntitlement } from '@/lib/server/domains/settings/cloud/entitlements'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import {
  isAssistantConfigured,
  runAssistantTurn,
} from '@/lib/server/domains/assistant/assistant.runtime'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { resolveSlackPrincipal, slackMemberActor } from './identity'
import {
  mapSlackThread,
  replyBlocks,
  slackThreadKey,
  formatSlackAnswer,
  toSlackMrkdwn,
  escapeSlack,
  SlackReplyStream,
  isSlackStoppedByUser,
} from './presentation'
import { missingSlackScopes } from '../../scopes'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isDuplicateSlackMentionEvent } from './addressing'
import {
  slackThreadSessionIsActive,
  stopSlackThreadSession,
  touchSlackThreadSession,
  markSlackThreadHeard,
} from './sessions'
import { beginSlackTurn, endSlackTurn } from './turns'

const log = logger.child({ component: 'slack-agent' })
type Payload = Record<string, any>
const prompts = [
  'What are the top requests this month?',
  'Summarise open conversations about billing',
  'What shipped in the last changelog?',
]

async function respondViaUrl(url: string, text: string, blocks?: KnownBlock[]): Promise<void> {
  const target = new URL(url)
  if (
    target.protocol !== 'https:' ||
    target.hostname !== 'hooks.slack.com' ||
    target.username ||
    target.password ||
    target.port
  )
    throw new Error('Invalid Slack response URL')
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      response_type: 'ephemeral',
      replace_original: false,
      text,
      ...(blocks
        ? {
            blocks: [
              { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } },
              ...blocks,
            ],
          }
        : {}),
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Slack response failed (${response.status})`)
}
async function ephemeral(
  client: WebClient,
  channel: string,
  user: string,
  text: string,
  responseUrl?: string
): Promise<void> {
  const state = await getAssistantRuntimeConfig()
  const blocks = [
    { type: 'section' as const, text: { type: 'mrkdwn' as const, text } },
    {
      type: 'context' as const,
      elements: [
        {
          type: 'mrkdwn' as const,
          text: `AI-generated · ${escapeSlack(state.config.identity.name)} for ${escapeSlack(state.workspaceName)}`,
        },
      ],
    },
  ]
  if (responseUrl) return respondViaUrl(responseUrl, text, blocks.slice(1))
  await client.chat.postEphemeral({ channel, user, text, blocks })
}

export async function handleSlackDecision(
  payload: Payload,
  client: WebClient,
  team: string
): Promise<void> {
  const user = payload.user?.id
  const channel = payload.channel?.id
  if (typeof user !== 'string' || typeof channel !== 'string') return
  const person = await resolveSlackPrincipal(team, user, client)
  if (!person) {
    await ephemeral(
      client,
      channel,
      user,
      'Only linked Quackback team members can decide proposals.'
    )
    return
  }
  const action = payload.actions?.find((a: Payload) =>
    ['qb_action_approve', 'qb_action_reject'].includes(a.action_id)
  )
  if (!action || !isTypeId(action.value, 'assistant_action')) return
  const { getPendingActionById } =
    await import('@/lib/server/domains/assistant/pending-actions.service')
  const pending = await getPendingActionById(action.value as AssistantPendingActionId)
  if (!pending || pending.originRole !== 'workspace_assistant' || !pending.workspaceThreadKey)
    return
  const [boundTeam, boundChannel, boundThread] = JSON.parse(pending.workspaceThreadKey)
  if (
    boundTeam !== team ||
    boundChannel !== channel ||
    (payload.message?.thread_ts && boundThread !== payload.message.thread_ts)
  )
    return
  const terminal = ['executed', 'rejected', 'failed'].includes(pending.status)
  const actor = terminal ? undefined : await slackMemberActor(person)
  const { getToolSpecByName } = await import('@/lib/server/domains/assistant/assistant.toolspec')
  const { getConnectorSpecByToolName } =
    await import('@/lib/server/domains/assistant/connectors/connector-tools')
  const { getWorkspaceMcpSpecByName } =
    await import('@/lib/server/domains/assistant/mcp-workspace-tools')
  const spec =
    getToolSpecByName(pending.toolName) ??
    (actor
      ? ((await getConnectorSpecByToolName(pending.toolName, 'workspace')) ??
        (await getWorkspaceMcpSpecByName(pending.toolName, actor, 'Quinn')))
      : null)
  if (
    !terminal &&
    (!spec ||
      spec.risk !== 'write' ||
      !actor ||
      toolPermissions(spec, true).some((permission) => !can(actor, permission)))
  ) {
    await ephemeral(client, channel, user, 'You do not have permission to decide this action.')
    return
  }
  let result = pending
  if (!terminal) {
    if (!actor) return
    try {
      const { decideAssistantAction } = await import('@/lib/server/functions/assistant-actions')
      result = await decideAssistantAction(
        pending.id,
        action.action_id === 'qb_action_approve' ? 'approved' : 'rejected',
        person.id,
        actor
      )
    } catch (error) {
      log.warn(
        { pendingActionId: pending.id, error: error instanceof Error ? error.name : 'Error' },
        'Slack decision failed'
      )
      await ephemeral(
        client,
        channel,
        user,
        'This proposal could not be decided. It may have expired or already been handled.'
      )
      return
    }
  }
  // Presentation failures propagate to the durable job. Its retry reads the settled
  // proposal and updates Slack without executing the post/ticket write again.
  const record = result.result ?? {}
  const link =
    typeof record.postId === 'string'
      ? `${getBaseUrl()}/admin/feedback?post=${encodeURIComponent(record.postId)}`
      : typeof record.ticketId === 'string'
        ? `${getBaseUrl()}/admin/inbox?i=${encodeURIComponent(record.ticketId)}`
        : null
  const status =
    result.status === 'executed'
      ? `Approved${result.decidedById && result.decidedById !== person.id ? '' : ` by <@${user}>`}${link ? ` → <${link}|Open>` : ''}`
      : result.status === 'rejected'
        ? `Rejected${result.decidedById && result.decidedById !== person.id ? '' : ` by <@${user}>`}`
        : 'The action could not be completed. Check Quackback before retrying.'
  const blocks = (payload.message?.blocks ?? []).map((block: Payload) =>
    block.type === 'actions' &&
    block.elements?.some((element: Payload) => element.value === pending.id)
      ? { type: 'context', elements: [{ type: 'mrkdwn', text: status }] }
      : block
  )
  if (payload.response_url && payload.container?.is_ephemeral) {
    const target = new URL(payload.response_url)
    if (
      target.protocol !== 'https:' ||
      target.hostname !== 'hooks.slack.com' ||
      target.username ||
      target.password ||
      target.port
    )
      throw new Error('Invalid response URL')
    const response = await fetch(target, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ replace_original: true, text: status, blocks }),
    })
    if (!response.ok) throw new Error('Slack update failed')
  } else if (payload.message?.ts) {
    await client.chat.update({ channel, ts: payload.message.ts, text: status, blocks })
  }
}

async function recordFeedback(payload: Payload, client: WebClient, team: string): Promise<void> {
  const event = payload.event
  const user = event?.user ?? payload.user?.id
  if (typeof user !== 'string') return
  const person = await resolveSlackPrincipal(team, user, client)
  if (!person) return
  const action = payload.actions?.find((a: Payload) => a.action_id === 'qb_feedback')
  let turnId: string | undefined
  let vote: string | undefined
  if (action) {
    const value = action.value ?? action.selected_option?.value
    if (typeof value !== 'string') return
    ;[turnId, vote] = value.split(':')
  } else if (
    event?.type === 'reaction_added' &&
    ['+1', '-1', 'thumbsup', 'thumbsdown'].includes(event.reaction)
  ) {
    const rows = await db
      .select()
      .from(assistantEvents)
      .where(
        and(
          eq(assistantEvents.eventType, 'slack.turn'),
          sql`${assistantEvents.metadata}->>'channel' = ${event.item?.channel}`,
          sql`${assistantEvents.metadata}->>'messageTs' = ${event.item?.ts}`
        )
      )
      .limit(1)
    turnId = rows[0]?.id
    vote = ['+1', 'thumbsup'].includes(event.reaction) ? 'up' : 'down'
  }
  if (!turnId || !isTypeId(turnId, 'assistant_event') || !['up', 'down'].includes(vote ?? ''))
    return
  const turn = await db.query.assistantEvents.findFirst({ where: eq(assistantEvents.id, turnId) })
  if (
    !turn ||
    turn.eventType !== 'slack.turn' ||
    turn.metadata.teamHash !== createHash('sha256').update(team).digest('hex')
  )
    return
  await db.insert(assistantEvents).values({
    eventType: 'feedback',
    principalId: person.id,
    metadata: { surface: 'slack', turnId, rating: vote },
  })
}

export async function handleSlackHookJob(job: ClaimedJob): Promise<void> {
  const kind = String(job.payload.kind)
  if (typeof job.payload.encryptedPayload !== 'string') return
  const payload = decryptSecrets<Payload>(job.payload.encryptedPayload)
  const row = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, 'slack'),
  })
  if (!row?.secrets) return
  const installation = (row.config ?? {}) as Payload
  const team = payload.team_id ?? payload.team?.id ?? payload.event?.team
  // A cached CP mapping or a reconnect must never deliver another Slack team's
  // event into this workspace, even though the provider signature is valid.
  if (typeof team !== 'string' || team !== installation.workspaceId) return
  const event = payload.event
  if (kind === 'events' && revokesSlackInstallation(event, installation.botUserId)) {
    const state = await getAssistantRuntimeConfig()
    let changedSettings = false
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'integration:slack'}))`)
      const current = await tx.query.integrations.findFirst({ where: eq(integrations.id, row.id) })
      // Reconnect serializes on this lock. A changed token/connection stamp means
      // the revocation belongs to the prior installation, including same-team reinstalls.
      if (
        !current ||
        current.secrets !== row.secrets ||
        current.connectedAt?.getTime() !== row.connectedAt?.getTime()
      )
        return
      const eventTime = Number(payload.event_time)
      if (
        Number.isFinite(eventTime) &&
        eventTime > 0 &&
        current.connectedAt &&
        current.connectedAt.getTime() > eventTime * 1000
      )
        return
      const { unregisterInstall } = await import('@/lib/server/integrations/install-registry')
      await unregisterInstall('slack', installation)
      await tx
        .update(integrations)
        .set({
          status: 'disconnected',
          lastError: 'Slack app access was revoked',
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, row.id))
      // Revision-guarded settings write preserves concurrent administrator edits.
      if (state.config.agents.workspace.slack.enabled) {
        await updateAssistantConfig(
          state.revision,
          (current) => ({
            ...current,
            agents: {
              ...current.agents,
              workspace: {
                ...current.agents.workspace,
                slack: { ...current.agents.workspace.slack, enabled: false },
              },
            },
          }),
          { type: 'system' },
          tx
        )
        changedSettings = true
      }
    })
    if (changedSettings) await invalidateSettingsCache()
    return
  }
  if (row.status !== 'active') {
    log.warn({ status: row.status }, 'slack hook ignored because the integration is not active')
    return
  }
  const secrets = decryptSecrets<{ accessToken: string }>(row.secrets)
  const client = new WebClient(secrets.accessToken, {
    retryConfig: { retries: 2 },
    timeout: 15_000,
  })
  if (kind === 'interactions' && payload.type === 'block_actions') {
    if (payload.actions?.some((action: Payload) => action.action_id === 'qb_feedback'))
      await recordFeedback(payload, client, team)
    else await handleSlackDecision(payload, client, team)
    return
  }
  if (event?.type === 'reaction_added') {
    await recordFeedback(payload, client, team)
    return
  }
  if (event?.type === 'agent_session_stopped') {
    const channel = event.channel
    const thread = event.thread_ts
    const user = event.user
    if (typeof channel === 'string' && typeof thread === 'string') {
      await client
        .apiCall('agents.sessions.setStatus', {
          channel_id: channel,
          thread_ts: thread,
          status: 'active',
        })
        .catch(() => {})
      if (typeof user === 'string')
        await ephemeral(client, channel, user, 'Okay — I stopped.').catch(() => {})
    }
    return
  }
  if (event?.type === 'app_home_opened' && event.tab === 'messages') {
    const person = await resolveSlackPrincipal(team, event.user, client)
    if (!person) return
    const link = await db.query.slackUserLinks.findFirst({
      where: and(eq(slackUserLinks.slackTeamId, team), eq(slackUserLinks.slackUserId, event.user)),
    })
    if (link?.suggestedPromptsAt && Date.now() - link.suggestedPromptsAt.getTime() < 30 * 86400_000)
      return
    // agent_view requires omitting thread_ts; the legacy thread parameter
    // silently fails for agent apps (Slack docs checked 2026-09-05).
    await client.assistant.threads.setSuggestedPrompts({
      channel_id: event.channel,
      prompts: prompts.map((message) => ({ title: message, message })),
    })
    await db
      .update(slackUserLinks)
      .set({ suggestedPromptsAt: new Date() })
      .where(and(eq(slackUserLinks.slackTeamId, team), eq(slackUserLinks.slackUserId, event.user)))
    return
  }
  const command =
    kind === 'commands' &&
    typeof payload.command === 'string' &&
    (payload.command === '/quackback' || payload.command === '/qbdev')
  const shortcut =
    kind === 'interactions' &&
    payload.type === 'message_action' &&
    payload.callback_id === 'send_to_quackback'
  const isMention = event?.type === 'app_mention'
  const isDm = event?.type === 'message' && event.channel_type === 'im'
  // Slack emits both `app_mention` and `message` for the same @mention. DMs
  // only get `message`, so those stay on the question path.
  if (isDuplicateSlackMentionEvent(event, installation.botUserId)) return
  const threadTs =
    typeof event?.thread_ts === 'string'
      ? event.thread_ts
      : typeof event?.ts === 'string'
        ? event.ts
        : null
  const channelId = typeof event?.channel === 'string' ? event.channel : null
  const session =
    kind === 'events' && channelId && threadTs
      ? await slackThreadSessionIsActive(team, channelId, threadTs)
      : { active: false, lastSpeaker: 'none' as const }
  const question =
    kind === 'events' &&
    (isMention || isDm) &&
    !event.bot_id &&
    !event.subtype &&
    event.user !== installation.botUserId
  const followUp =
    kind === 'events' &&
    event?.type === 'message' &&
    typeof event.thread_ts === 'string' &&
    session.active &&
    !isMention &&
    !isDm &&
    !event.bot_id &&
    !event.subtype &&
    event.user !== installation.botUserId
  if (!command && !shortcut && !question && !followUp) {
    log.info(
      { kind, eventType: event?.type, channelType: event?.channel_type, subtype: event?.subtype },
      'slack hook ignored; not a handled question'
    )
    return
  }
  await handleSlackQuestion({
    payload,
    event: shortcut ? payload.message : event,
    team,
    client,
    installation,
    command,
    shortcut,
  })
}

async function handleSlackQuestion(input: {
  payload: Payload
  event: Payload
  team: string
  client: WebClient
  installation: Payload
  command: boolean
  shortcut: boolean
  threadHistory?: Array<{ user?: string; text?: string; ts?: string }>
}): Promise<void> {
  const { payload, event, team, client, installation, command, shortcut } = input
  const channel = command ? payload.channel_id : shortcut ? payload.channel?.id : event?.channel
  const user = command ? payload.user_id : shortcut ? payload.user?.id : event?.user
  if (typeof channel !== 'string' || typeof user !== 'string') return
  const responseUrl = command ? payload.response_url : undefined
  const replyError = (text: string) => ephemeral(client, channel, user, text, responseUrl)
  const state = await getAssistantRuntimeConfig()
  if (
    !state.config.agents.workspace.slack.enabled ||
    !state.config.agents.workspace.capabilities.qa
  ) {
    await replyError('Enable the AI assistant in Quackback’s Slack settings first.')
    return
  }
  if (!isAssistantConfigured()) {
    await replyError('Configure an AI model in Quackback first.')
    return
  }
  if (!(await hasEntitlement('aiDrafts'))) {
    await replyError('Your Quackback plan does not include teammate AI.')
    return
  }
  try {
    await enforceAiTokenBudget()
  } catch {
    await replyError('This workspace has reached its AI usage limit.')
    return
  }
  if (missingSlackScopes(installation.scopes).length) {
    await replyError('Reconnect Slack in Quackback to grant the assistant permissions.')
    return
  }
  const person = await resolveSlackPrincipal(team, user, client)
  if (!person) {
    await replyError(
      `I can only answer for Quackback team members. Sign in at ${getBaseUrl()}/admin with the email you use in Slack, then mention me again.`
    )
    return
  }
  const actor = await slackMemberActor(person)
  if (!can(actor, PERMISSIONS.COPILOT_USE)) {
    await replyError('You do not have permission to use Quackback’s AI assistant.')
    return
  }
  const thread = command ? payload.trigger_id : (event.thread_ts ?? event.ts)
  if (typeof thread !== 'string') return
  const turnId = generateId('assistant_event')
  const assistant = await ensureAssistantPrincipal()
  const text = command
    ? payload.text
    : shortcut
      ? `Capture this message as feedback: ${event.text ?? ''}`
      : event.text
  const turnAbort = command ? new AbortController() : beginSlackTurn(team, channel, thread)
  let stream: ReturnType<WebClient['chatStream']> | null = null
  let replyStream: SlackReplyStream | null = null
  let stopped = false
  try {
    if (!command)
      await client.apiCall('agents.sessions.setStatus', {
        channel_id: channel,
        thread_ts: thread,
        status: 'processing',
        initiator_user_id: user,
      })
    if (turnAbort.signal.aborted) return
    let history: Array<{ user?: string; text?: string; ts?: string }> = []
    if (!command) {
      history =
        input.threadHistory ??
        (
          await client.conversations.replies({
            channel,
            ts: thread,
            limit: 12,
            latest: event.ts,
            inclusive: true,
          })
        ).messages ??
        []
    }
    if (turnAbort.signal.aborted) return
    const context = mapSlackThread(
      history,
      { text, ts: event?.ts, user },
      installation.botUserId ?? ''
    )
    stream = command
      ? null
      : client.chatStream({
          channel,
          thread_ts: thread,
          recipient_team_id: team,
          recipient_user_id: user,
        })
    replyStream = stream ? new SlackReplyStream(stream, () => turnAbort.abort()) : null
    if (replyStream) {
      const live = replyStream
      turnAbort.signal.addEventListener('abort', () => live.cancel(), { once: true })
    }
    const streaming = replyStream
    const result = await runAssistantTurn({
      role: 'workspace_assistant',
      actor,
      surface: 'slack',
      ...context,
      workspaceThreadKey: slackThreadKey(team, channel, thread),
      latestCustomerMessageId: payload.event_id ?? payload.trigger_id,
      assistantPrincipalId: assistant.id,
      actorPrincipalId: person.id,
      telemetryTurnId: turnId,
      signal: turnAbort.signal,
      onTextDelta: streaming ? (delta) => streaming.push(delta) : undefined,
    })
    if (turnAbort.signal.aborted) {
      await replyStream?.abandon()
      return
    }
    if (result.status === 'suppressed') {
      if (result.reason === 'not_addressed') {
        if (result.listen === 'leave') {
          await stopSlackThreadSession(team, channel, thread)
          if (typeof user === 'string')
            await ephemeral(
              client,
              channel,
              user,
              'Okay — I’ll sit this one out. Mention me if you need me again.'
            )
        } else if (!command) {
          await markSlackThreadHeard(team, channel, thread)
        }
        return
      }
      if (stream) {
        await stream.stop({
          markdown_text: `I don’t have a reply for that message.\n_AI-generated · ${escapeSlack(state.config.identity.name)} for ${escapeSlack(state.workspaceName)}_`,
        })
      }
      if (!command) await touchSlackThreadSession(team, channel, thread, 'bot')
      return
    }
    const formatted = formatSlackAnswer(result.text)
    const blocks = replyBlocks(
      result.citations,
      result.proposedActions,
      turnId,
      result.identity.name,
      state.workspaceName,
      getBaseUrl()
    )
    if (command) await respondViaUrl(responseUrl, toSlackMrkdwn(formatted), blocks)
    else if (replyStream) {
      await replyStream.finish({ fallbackText: formatted, blocks })
      stopped = true
    }
    await db.insert(assistantEvents).values({
      id: turnId,
      eventType: 'slack.turn',
      principalId: person.id,
      metadata: {
        surface: 'slack',
        teamHash: createHash('sha256').update(team).digest('hex'),
        channel,
        threadTs: thread,
        messageTs: stream?.ts ?? null,
      },
    })
    if (!command) {
      if (result.listen === 'leave') await stopSlackThreadSession(team, channel, thread)
      else await touchSlackThreadSession(team, channel, thread, 'bot')
    }
  } catch (error) {
    if (turnAbort.signal.aborted || isSlackStoppedByUser(error)) {
      await replyStream?.abandon()
      return
    }
    // Never log SDK request objects, Slack messages, or model text.
    const message = error instanceof Error ? error.message : ''
    log.error(
      {
        error: error instanceof Error ? error.name : 'Error',
        kind: message.startsWith('Failed to parse structured output')
          ? 'structured_output'
          : 'unknown',
        turnId,
      },
      'Slack assistant turn failed'
    )
    if (stream && !stopped)
      await stream
        .stop({
          markdown_text: `Something went wrong on my side. Try again in a moment.\n_AI-generated · ${escapeSlack(state.config.identity.name)} for ${escapeSlack(state.workspaceName)}_`,
        })
        .catch(() => {})
    else if (command) await replyError('Something went wrong on my side. Try again in a moment.')
  } finally {
    if (!command) endSlackTurn(team, channel, thread, turnAbort)
    if (!command)
      await client
        .apiCall('agents.sessions.setStatus', {
          channel_id: channel,
          thread_ts: thread,
          status: 'active',
        })
        .catch(() => {})
  }
}
