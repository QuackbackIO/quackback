/**
 * GitHub inbox-channel ingest. Issues and issue comments become conversations
 * the same way cold inbound email does: direct inserts (not sendVisitorMessage).
 * Tracker-created issues stay on post/ticket links and never spawn a channel
 * thread. Issue closed/reopened syncs conversation status; a comment on a
 * closed issue does not reopen it. Comment edits and deletes follow the issue,
 * and the open inbox thread updates over SSE. An issue edit follows into the
 * conversation's subject and opening message. Only repositories that bring
 * their issues in (`inboundMode` `conversations` or `tickets`) are ingested;
 * a `tickets` repository also opens a customer ticket paired with each
 * conversation and keeps it in step with the issue
 * (conversation.github-tickets.ts).
 */
import {
  db,
  eq,
  and,
  asc,
  isNull,
  sql,
  integrations,
  conversations,
  conversationMessages,
} from '@/lib/server/db'
import type {
  ChannelAccountId,
  ConversationId,
  IntegrationDestinationId,
  IntegrationId,
  PrincipalId,
} from '@quackback/ids'
import { githubLoginsMatch, githubThreadKey } from '@/lib/server/domains/channels/github-thread'
import {
  getLiveGitHubConnectionAccount,
  githubInboundMode,
  githubRepositoryIngests,
  githubTicketScope,
} from '@/lib/server/domains/channel-accounts/github-connection'
import {
  recordDestinationError,
  type IntegrationDestination,
} from '@/lib/server/integrations/destinations'
import { logger } from '@/lib/server/logger'
import { lookupChannelThread } from './conversation.inbound-resolve'
import { channelCloseSystemCopy } from '@/lib/shared/channels'
import {
  applyGitHubIssueStateToTicket,
  githubIssueState,
  openTicketForGitHubIssue,
  renameTicketForGitHubIssue,
} from './conversation.github-tickets'
import {
  appendGitHubComment,
  createGitHubConversation,
  findGitHubCommentMessage,
  githubCommentExists,
  isTrackerOwnedIssue,
  hasQuackbackMarker,
  markdownBody,
  publishGitHubInboxMessage,
  type GitHubComment,
  type GitHubIssue,
  type GitHubUser,
} from './conversation.github-inbound-store'

const log = logger.child({ component: 'github-channel-inbound' })

interface GitHubPayload {
  action?: string
  issue?: GitHubIssue
  comment?: GitHubComment
  repository?: { full_name?: string }
  sender?: GitHubUser
  /** On `issues.edited`: the fields that changed, with their old values. */
  changes?: { title?: unknown; body?: unknown }
}

interface IntegrationRow {
  id: IntegrationId
  config: unknown
  /** The integration's service principal, which acts on the tickets it opens. */
  principalId?: PrincipalId | null
}

export async function ingestGitHubChannelEvent(opts: {
  body: string
  eventName: string | null
  integration: IntegrationRow
  /**
   * The repository the signed delivery was routed to, when the webhook is per
   * repository. Absent for a legacy delivery from the connection's default
   * repository before it had a row; that one is ingested as it always was.
   */
  destination?: Pick<IntegrationDestination, 'externalId' | 'config' | 'enabled'> & {
    id?: IntegrationDestinationId
  }
}): Promise<void> {
  const account = await getLiveGitHubConnectionAccount()
  if (!account) return
  // Each repository chooses whether its issues come into the inbox.
  if (opts.destination && !githubRepositoryIngests(opts.destination)) return

  let payload: GitHubPayload
  try {
    payload = JSON.parse(opts.body) as GitHubPayload
  } catch {
    return
  }

  const kind = eventKind(opts.eventName, payload)
  if (kind === 'ignore') return

  const config = (opts.integration.config ?? {}) as Record<string, unknown>
  const botLogin = typeof config.username === 'string' ? config.username : undefined
  const ownerRepo =
    payload.repository?.full_name ||
    opts.destination?.externalId ||
    (typeof config.channelId === 'string' ? config.channelId : null)
  const issue = payload.issue
  if (!ownerRepo || !issue?.number) return
  if (issue.pull_request) return

  const issueNumber = String(issue.number)
  const threadKey = githubThreadKey(ownerRepo, issueNumber)
  const channelAccountId = account.id as ChannelAccountId
  // A legacy delivery routed to no repository row only ever opens conversations.
  const ticketsMode = !!opts.destination && githubInboundMode(opts.destination.config) === 'tickets'
  const senderIsBot = githubLoginsMatch(botLogin, payload.sender?.login)
  const openTicket = async (conversationId: ConversationId) => {
    if (!ticketsMode) return
    try {
      await openTicketForGitHubIssue({
        conversationId,
        issueTitle: issue.title,
        scope: githubTicketScope(opts.destination?.config),
        integrationPrincipalId: opts.integration.principalId ?? null,
      })
    } catch (err) {
      // The conversation is in; a redelivery of the issue opens the ticket.
      const raw = err instanceof Error ? err.message : String(err)
      if (opts.destination?.id)
        await recordDestinationError(
          opts.destination.id,
          `Could not open a ticket for ${threadKey}: ${raw}`
        ).catch(() => {})
      throw err
    }
  }

  if (kind === 'opened') {
    const actorLogin = issue.user?.login
    if (githubLoginsMatch(botLogin, actorLogin)) return
    // Our own issues (a marker in the body) belong to tracker sync, not the inbox.
    if (hasQuackbackMarker(issue.body)) return
    const existing = await lookupChannelThread(channelAccountId, threadKey)
    if (existing) {
      // A redelivery: open the ticket a failed first delivery did not.
      await openTicket(existing)
      return
    }
    const conversationId = await createGitHubConversation({
      channelAccountId,
      threadKey,
      issue,
      issueNumber,
    })
    await openTicket(conversationId)
    await bumpLastInbound(opts.integration.id)
    return
  }

  if (kind === 'closed' || kind === 'reopened') {
    const conversationId = await lookupChannelThread(channelAccountId, threadKey)
    if (conversationId) {
      await applyGitHubIssueState(conversationId, kind === 'closed' ? 'closed' : 'open')
      // Our own close or reopen is the echo of a ticket moved in Quackback.
      if (ticketsMode && !senderIsBot)
        await applyGitHubIssueStateToTicket({
          conversationId,
          state: githubIssueState(kind, issue.state_reason),
          integration: opts.integration,
          repositoryConfig: opts.destination?.config ?? {},
          issue: { reference: threadKey, url: issue.html_url ?? null },
          deliveryKey: `github:${threadKey}:${kind}:${issue.updated_at ?? Date.now()}`,
        })
      await bumpLastInbound(opts.integration.id)
    }
    return
  }

  if (kind === 'edited') {
    // Echo guard: our own edits, and bodies carrying our marker.
    if (senderIsBot || hasQuackbackMarker(issue.body)) return
    const conversationId = await lookupChannelThread(channelAccountId, threadKey)
    if (!conversationId) return
    await applyGitHubIssueEdit(conversationId, issue, payload.changes)
    if (ticketsMode && payload.changes?.title)
      await renameTicketForGitHubIssue({
        conversationId,
        issueTitle: issue.title,
        integrationPrincipalId: opts.integration.principalId ?? null,
      })
    await bumpLastInbound(opts.integration.id)
    return
  }

  if (kind === 'comment_edited' || kind === 'comment_deleted') {
    const edited = payload.comment
    if (!edited?.id) return
    if (kind === 'comment_edited') await applyGitHubCommentEdit(String(edited.id), edited.body)
    else await applyGitHubCommentDelete(String(edited.id))
    await bumpLastInbound(opts.integration.id)
    return
  }

  const comment = payload.comment
  if (!comment?.id) return
  const commenterLogin = comment.user?.login ?? payload.sender?.login
  // Echo guard: our own comments, and bodies carrying our marker (a ticket
  // reply mirrored onto a linked issue).
  if (githubLoginsMatch(botLogin, commenterLogin) || hasQuackbackMarker(comment.body)) return

  const commentId = String(comment.id)
  if (await githubCommentExists(commentId)) return

  let conversationId = await lookupChannelThread(channelAccountId, threadKey)
  if (!conversationId) {
    const trackerOwned = await isTrackerOwnedIssue(
      ownerRepo,
      issueNumber,
      botLogin,
      issue.user?.login,
      issue.body
    )
    if (trackerOwned) return
    conversationId = await createGitHubConversation({
      channelAccountId,
      threadKey,
      issue,
      issueNumber,
    })
    await openTicket(conversationId)
  }

  await appendGitHubComment({
    conversationId,
    comment,
    issueNumber,
    commenter: comment.user ?? payload.sender ?? {},
  })
  await bumpLastInbound(opts.integration.id)
}

function eventKind(
  eventName: string | null,
  payload: GitHubPayload
):
  | 'opened'
  | 'edited'
  | 'comment'
  | 'comment_edited'
  | 'comment_deleted'
  | 'closed'
  | 'reopened'
  | 'ignore' {
  const action = payload.action
  if (eventName === 'issue_comment' || payload.comment) {
    if (action === 'created') return 'comment'
    if (action === 'edited') return 'comment_edited'
    if (action === 'deleted') return 'comment_deleted'
    return 'ignore'
  }
  if (eventName === 'issues' || (payload.issue && !payload.comment)) {
    if (action === 'opened') return 'opened'
    if (action === 'edited') return 'edited'
    if (action === 'closed') return 'closed'
    if (action === 'reopened') return 'reopened'
  }
  return 'ignore'
}

async function applyGitHubCommentEdit(githubCommentId: string, body: string | undefined) {
  const row = await findGitHubCommentMessage(githubCommentId)
  if (!row?.conversationId) return
  const { content, contentJson } = markdownBody(body)
  const [updated] = await db
    .update(conversationMessages)
    .set({
      content: content || row.content,
      contentJson: contentJson ?? row.contentJson,
      editedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversationMessages.id, row.id))
    .returning()
  if (updated) await publishGitHubInboxMessage(updated, 'updated')
}

/**
 * An edited issue: a new title becomes the conversation's subject, a new body
 * its opening message (the issue's own row, the one without a comment id).
 */
async function applyGitHubIssueEdit(
  conversationId: ConversationId,
  issue: GitHubIssue,
  changes: GitHubPayload['changes']
): Promise<void> {
  if (changes?.title && issue.title) {
    const [updated] = await db
      .update(conversations)
      .set({ subject: issue.title.slice(0, 200), updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning()
    if (updated) {
      const { conversationToDTO } = await import('./conversation.query')
      const { publishConversationUpdate } =
        await import('@/lib/server/realtime/conversation-channels')
      await publishConversationUpdate(conversationId, await conversationToDTO(updated, 'agent'))
    }
  }
  if (changes?.body) {
    const [opening] = await db
      .select()
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          sql`${conversationMessages.metadata} ->> 'githubIssueNumber' IS NOT NULL`,
          sql`${conversationMessages.metadata} ->> 'githubCommentId' IS NULL`,
          isNull(conversationMessages.deletedAt)
        )
      )
      .orderBy(asc(conversationMessages.createdAt))
      .limit(1)
    if (!opening) return
    const { content, contentJson } = markdownBody(issue.body)
    const [updated] = await db
      .update(conversationMessages)
      .set({
        content: content || issue.title || opening.content,
        contentJson,
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversationMessages.id, opening.id))
      .returning()
    if (updated) await publishGitHubInboxMessage(updated, 'updated')
  }
}

async function applyGitHubCommentDelete(githubCommentId: string) {
  const row = await findGitHubCommentMessage(githubCommentId)
  if (!row?.conversationId) return
  await db
    .update(conversationMessages)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationMessages.id, row.id))
  const { publishAgentConversationEvent } =
    await import('@/lib/server/realtime/conversation-channels')
  publishAgentConversationEvent({
    kind: 'message_deleted',
    conversationId: row.conversationId,
    messageId: row.id,
  })
}

async function applyGitHubIssueState(
  conversationId: ConversationId,
  state: 'open' | 'closed'
): Promise<void> {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!existing) return
  if (state === 'closed' && existing.status === 'closed') return
  if (state === 'open' && existing.status === 'open') return
  const now = new Date()
  const [updated] = await db
    .update(conversations)
    .set({
      status: state,
      resolvedAt: state === 'closed' ? now : null,
      snoozedUntil: null,
      waitingSince: state === 'closed' ? null : now,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId))
    .returning()
  if (!updated) return
  const copy = channelCloseSystemCopy('github')
  const { emitSystemMessage } = await import('./conversation.service')
  await emitSystemMessage(conversationId, state === 'closed' ? copy.ended : copy.reopened, {
    kind: state === 'closed' ? 'chat_ended' : 'chat_reopened',
  })
  const { conversationToDTO } = await import('./conversation.query')
  const { publishConversationUpdate } = await import('@/lib/server/realtime/conversation-channels')
  await publishConversationUpdate(conversationId, await conversationToDTO(updated, 'agent'))
}

async function bumpLastInbound(integrationId: IntegrationId): Promise<void> {
  await db
    .update(integrations)
    .set({ lastInboundAt: new Date() })
    .where(eq(integrations.id, integrationId))
    .catch((err) => {
      log.warn({ err, integration_id: integrationId }, 'failed to stamp last inbound')
    })
}
