/**
 * GitHub inbox-channel ingest. Issues and issue comments become conversations
 * the same way cold inbound email does: direct inserts (not sendVisitorMessage).
 * Tracker-created issues stay on post/ticket links and never spawn a channel
 * thread. Issue closed/reopened syncs conversation status; a comment on a
 * closed issue does not reopen it. Comment edits and deletes follow the issue,
 * and the open inbox thread updates over SSE.
 */
import { db, eq, integrations, conversations, conversationMessages } from '@/lib/server/db'
import type { ChannelAccountId, ConversationId, IntegrationId } from '@quackback/ids'
import { githubLoginsMatch, githubThreadKey } from '@/lib/server/domains/channels/github-thread'
import { getLiveGitHubConnectionAccount } from '@/lib/server/domains/channel-accounts/github-connection'
import { logger } from '@/lib/server/logger'
import { lookupChannelThread } from './conversation.inbound-resolve'
import { channelCloseSystemCopy } from '@/lib/shared/channels'
import {
  appendGitHubComment,
  createGitHubConversation,
  findGitHubCommentMessage,
  githubCommentExists,
  isTrackerOwnedIssue,
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
}

interface IntegrationRow {
  id: IntegrationId
  config: unknown
}

export async function ingestGitHubChannelEvent(opts: {
  body: string
  eventName: string | null
  integration: IntegrationRow
}): Promise<void> {
  const account = await getLiveGitHubConnectionAccount()
  if (!account) return

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
    (typeof config.channelId === 'string' ? config.channelId : null)
  const issue = payload.issue
  if (!ownerRepo || !issue?.number) return

  const issueNumber = String(issue.number)
  const threadKey = githubThreadKey(ownerRepo, issueNumber)
  const channelAccountId = account.id as ChannelAccountId

  if (kind === 'opened') {
    const actorLogin = issue.user?.login
    if (githubLoginsMatch(botLogin, actorLogin)) return
    const existing = await lookupChannelThread(channelAccountId, threadKey)
    if (existing) return
    await createGitHubConversation({
      channelAccountId,
      threadKey,
      issue,
      issueNumber,
    })
    await bumpLastInbound(opts.integration.id)
    return
  }

  if (kind === 'closed' || kind === 'reopened') {
    const conversationId = await lookupChannelThread(channelAccountId, threadKey)
    if (conversationId) {
      await applyGitHubIssueState(conversationId, kind === 'closed' ? 'closed' : 'open')
      await bumpLastInbound(opts.integration.id)
    }
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
  if (githubLoginsMatch(botLogin, commenterLogin)) return

  const commentId = String(comment.id)
  if (await githubCommentExists(commentId)) return

  let conversationId = await lookupChannelThread(channelAccountId, threadKey)
  if (!conversationId) {
    const trackerOwned = await isTrackerOwnedIssue(issueNumber, botLogin, issue.user?.login)
    if (trackerOwned) return
    conversationId = await createGitHubConversation({
      channelAccountId,
      threadKey,
      issue,
      issueNumber,
    })
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
): 'opened' | 'comment' | 'comment_edited' | 'comment_deleted' | 'closed' | 'reopened' | 'ignore' {
  const action = payload.action
  if (eventName === 'issue_comment' || payload.comment) {
    if (action === 'created') return 'comment'
    if (action === 'edited') return 'comment_edited'
    if (action === 'deleted') return 'comment_deleted'
    return 'ignore'
  }
  if (eventName === 'issues' || (payload.issue && !payload.comment)) {
    if (action === 'opened') return 'opened'
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
      updatedAt: new Date(),
    })
    .where(eq(conversationMessages.id, row.id))
    .returning()
  if (updated) await publishGitHubInboxMessage(updated, 'updated')
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
  publishConversationUpdate(conversationId, await conversationToDTO(updated, 'agent'))
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
