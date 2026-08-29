/**
 * Persist GitHub inbox conversations: issue threads, comment rows, sender
 * identity, and issue open/closed state.
 */
import {
  db,
  eq,
  and,
  sql,
  isNull,
  user,
  principal,
  conversations,
  conversationMessages,
  postExternalLinks,
  ticketExternalLinks,
  type ConversationMessage,
  type ConversationMessageMetadata,
  type TiptapContent,
} from '@/lib/server/db'
import type { ChannelAccountId, ConversationId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { sanitizeTiptapContent } from '@/lib/server/sanitize-tiptap'
import { githubMarkdownToTiptapJson, tiptapJsonToText } from '@/lib/server/markdown-tiptap'
import {
  createPrincipal,
  ensurePrincipalForUser,
} from '@/lib/server/domains/principals/principal.factory'
import {
  recordChannelIdentity,
  resolvePrincipalIdByChannelIdentity,
} from './conversation.email-store'
import { lookupChannelThread, rememberChannelThread } from './conversation.inbound-resolve'
import { emitConversationCreated, emitMessageCreated } from './conversation.webhooks'
import type { ConversationAuthorInput } from './conversation.types'
import { githubLoginsMatch } from '@/lib/server/domains/channels/github-thread'
import { isUniqueViolation } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'
import { applyVisitorReopenStatus } from './conversation.lifecycle'

const log = logger.child({ component: 'github-channel-inbound' })

export const GITHUB_CHANNEL = 'github'
const GITHUB_IMAGE_HOSTS = ['githubusercontent.com']

export interface GitHubUser {
  id?: number
  login?: string
  email?: string | null
  avatar_url?: string | null
}

export interface GitHubIssue {
  number?: number
  title?: string
  body?: string | null
  html_url?: string
  user?: GitHubUser
  /** Present on pull-request payloads that reuse the issues/comment events. */
  pull_request?: unknown
}

export interface GitHubComment {
  id?: number
  body?: string
  html_url?: string
  user?: GitHubUser
}

export async function githubCommentExists(githubCommentId: string): Promise<boolean> {
  return !!(await findGitHubCommentMessage(githubCommentId))
}

export async function isTrackerOwnedIssue(
  issueNumber: string,
  botLogin: string | undefined,
  issueAuthorLogin: string | undefined
): Promise<boolean> {
  if (githubLoginsMatch(botLogin, issueAuthorLogin)) return true
  const [postLink] = await db
    .select({ id: postExternalLinks.id })
    .from(postExternalLinks)
    .where(
      and(
        eq(postExternalLinks.integrationType, 'github'),
        eq(postExternalLinks.externalId, issueNumber)
      )
    )
    .limit(1)
  if (postLink) return true
  const [ticketLink] = await db
    .select({ id: ticketExternalLinks.id })
    .from(ticketExternalLinks)
    .where(
      and(
        eq(ticketExternalLinks.integrationType, 'github'),
        eq(ticketExternalLinks.externalId, issueNumber)
      )
    )
    .limit(1)
  return !!ticketLink
}

export async function createGitHubConversation(input: {
  channelAccountId: ChannelAccountId
  threadKey: string
  issue: GitHubIssue
  issueNumber: string
}): Promise<ConversationId> {
  const sender = await resolveGitHubSender(input.issue.user ?? {})
  const { content, contentJson } = markdownBody(input.issue.body)
  const now = new Date()
  const preview = (content || input.issue.title || '').slice(0, 200)
  const githubUrl = input.issue.html_url ?? null
  const customAttributes: Record<string, unknown> = {}
  if (githubUrl) customAttributes.githubUrl = githubUrl
  if (sender.unverified) customAttributes.unverifiedSender = true

  const metadata: ConversationMessageMetadata = {
    source: 'github',
    githubIssueNumber: input.issueNumber,
  }

  try {
    const { conversation, message } = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(conversations)
        .values({
          visitorPrincipalId: sender.principalId,
          channel: GITHUB_CHANNEL,
          source: GITHUB_CHANNEL,
          channelAccountId: input.channelAccountId,
          status: 'open',
          subject: (input.issue.title ?? '').slice(0, 200) || null,
          lastMessagePreview: preview,
          lastMessageAt: now,
          waitingSince: now,
          customAttributes,
        })
        .returning()

      const [inserted] = await tx
        .insert(conversationMessages)
        .values({
          conversationId: created.id,
          principalId: sender.principalId,
          senderType: 'visitor',
          content: content || input.issue.title || '',
          contentJson,
          metadata,
        })
        .returning()
      return { conversation: created, message: inserted }
    })

    await rememberChannelThread({
      channelAccountId: input.channelAccountId,
      externalThreadKey: input.threadKey,
      conversationId: conversation.id,
    })

    const actor: Actor = {
      principalId: sender.principalId,
      role: 'user',
      principalType: 'anonymous',
      segmentIds: new Set(),
    }
    const author: ConversationAuthorInput = {
      principalId: sender.principalId,
      displayName: input.issue.user?.login ?? null,
    }
    await emitConversationCreated(actor, author, conversation)
    await emitMessageCreated(actor, author, message, conversation, true)
    await publishGitHubInboxMessage(message, 'created')
    try {
      const { routeUnassignedConversation } = await import('./conversation.service')
      await routeUnassignedConversation(conversation)
    } catch (err) {
      log.warn({ err, conversation_id: conversation.id }, 'github inbound routing failed')
    }
    return conversation.id
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = await lookupChannelThread(input.channelAccountId, input.threadKey)
      if (existing) return existing
    }
    throw err
  }
}

export async function appendGitHubComment(input: {
  conversationId: ConversationId
  comment: GitHubComment
  issueNumber: string
  commenter: GitHubUser
}): Promise<void> {
  const commentId = String(input.comment.id)
  const sender = await resolveGitHubSender(input.commenter)
  const { content, contentJson } = markdownBody(input.comment.body)
  const now = new Date()
  const metadata: ConversationMessageMetadata = {
    source: 'github',
    githubCommentId: commentId,
    githubIssueNumber: input.issueNumber,
  }

  try {
    const { conversation, message } = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, input.conversationId))
        .limit(1)
      if (!existing) return { conversation: undefined, message: undefined }
      const nextStatus = applyVisitorReopenStatus(existing.status, false, 'never')
      const [inserted] = await tx
        .insert(conversationMessages)
        .values({
          conversationId: input.conversationId,
          principalId: sender.principalId,
          senderType: 'visitor',
          content: content || '(comment)',
          contentJson,
          metadata,
        })
        .returning()

      const [updated] = await tx
        .update(conversations)
        .set({
          status: nextStatus,
          resolvedAt: nextStatus === 'closed' ? existing.resolvedAt : null,
          snoozedUntil: nextStatus === 'closed' ? existing.snoozedUntil : null,
          waitingSince: nextStatus === 'closed' ? existing.waitingSince : now,
          lastMessageAt: now,
          lastMessagePreview: (content || '').slice(0, 200),
          updatedAt: now,
        })
        .where(eq(conversations.id, input.conversationId))
        .returning()
      return { conversation: updated, message: inserted }
    })

    if (!conversation || !message) return
    const actor: Actor = {
      principalId: sender.principalId,
      role: 'user',
      principalType: 'anonymous',
      segmentIds: new Set(),
    }
    const author: ConversationAuthorInput = {
      principalId: sender.principalId,
      displayName: input.commenter.login ?? null,
    }
    await emitMessageCreated(actor, author, message, conversation, false)
    await publishGitHubInboxMessage(message, 'created')
  } catch (err) {
    if (isUniqueViolation(err)) return
    throw err
  }
}

export async function findGitHubCommentMessage(githubCommentId: string) {
  const [row] = await db
    .select()
    .from(conversationMessages)
    .where(
      and(
        sql`${conversationMessages.metadata} ->> 'githubCommentId' = ${githubCommentId}`,
        isNull(conversationMessages.deletedAt)
      )
    )
    .limit(1)
  return row ?? null
}

export async function publishGitHubInboxMessage(
  message: ConversationMessage,
  mode: 'created' | 'updated'
) {
  const { toMessageDTO, loadAuthors, fallbackAuthor } = await import('./conversation.query')
  const { asAgentMessage } = await import('@/lib/shared/conversation/types')
  const { publishConversationEvent, publishAgentConversationEvent } =
    await import('@/lib/server/realtime/conversation-channels')
  if (!message.conversationId) return
  const author = message.principalId
    ? ((await loadAuthors([message.principalId])).get(message.principalId) ??
      fallbackAuthor(message.principalId))
    : null
  const dto = asAgentMessage(toMessageDTO(message, author))
  if (mode === 'created') {
    publishConversationEvent(message.conversationId, {
      kind: 'message',
      conversationId: message.conversationId,
      message: dto,
    })
  } else {
    publishAgentConversationEvent({
      kind: 'message_updated',
      conversationId: message.conversationId,
      message: dto,
    })
  }
}

async function resolveGitHubSender(
  ghUser: GitHubUser
): Promise<{ principalId: PrincipalId; unverified: boolean }> {
  const externalId = ghUser.id != null ? String(ghUser.id) : ''
  if (externalId) {
    const existing = await resolvePrincipalIdByChannelIdentity(GITHUB_CHANNEL, externalId)
    if (existing) {
      if (ghUser.avatar_url) {
        await db
          .update(principal)
          .set({ avatarUrl: ghUser.avatar_url })
          .where(and(eq(principal.id, existing), isNull(principal.avatarUrl)))
          .catch(() => {})
      }
      return { principalId: existing, unverified: false }
    }
  }

  const email = ghUser.email?.trim().toLowerCase()
  if (email) {
    const [known] = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email))
      .limit(1)
    if (known) {
      const { principal: attached } = await ensurePrincipalForUser({
        userId: known.id,
        role: 'user',
      })
      if (externalId) {
        await recordChannelIdentity(GITHUB_CHANNEL, externalId, attached.id, true)
      }
      return { principalId: attached.id, unverified: false }
    }
  }

  const lead = await createPrincipal({
    role: 'user',
    type: 'anonymous',
    displayName: ghUser.login ?? null,
    avatarUrl: ghUser.avatar_url ?? null,
  })
  if (externalId) {
    await recordChannelIdentity(GITHUB_CHANNEL, externalId, lead.id, false)
  }
  return { principalId: lead.id, unverified: true }
}

export function markdownBody(raw: string | null | undefined): {
  content: string
  contentJson: TiptapContent | null
} {
  const markdown = (raw ?? '').trim()
  if (!markdown) return { content: '', contentJson: null }
  const contentJson = sanitizeTiptapContent(githubMarkdownToTiptapJson(markdown), {
    restrictImagesToTrustedOrigins: true,
    extraTrustedImageHosts: GITHUB_IMAGE_HOSTS,
  }) as TiptapContent
  const content = tiptapJsonToText(contentJson).trim() || markdown.slice(0, 10_000)
  return { content, contentJson }
}
