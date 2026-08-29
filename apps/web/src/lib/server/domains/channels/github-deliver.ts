import { db, eq, and, channelAccounts, integrations } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { issueError } from '@/lib/server/integrations/message-utils'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import { lookupChannelThreadByConversation } from '@/lib/server/domains/conversation/conversation.inbound-resolve'
import { persistChannelDelivery } from '@/lib/server/domains/conversation/conversation.channel-delivery'
import { logger } from '@/lib/server/logger'
import { parseGitHubThreadKey } from './github-thread'
import type { AgentMessageDeliveryCtx, LifecycleDeliveryCtx, LifecycleKind } from './types'

const log = logger.child({ component: 'github-channel' })
const GITHUB_API = 'https://api.github.com'

async function noteAuthFailure(integrationId: string): Promise<void> {
  const { recordIntegrationLastError } =
    await import('@/lib/server/integrations/webhook-registration')
  await recordIntegrationLastError(
    integrationId as never,
    'Authentication failed. Please reconnect GitHub.'
  ).catch(() => {})
}

const githubHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'quackback',
  'X-GitHub-Api-Version': '2022-11-28',
})

async function loadGitHubIntegration(integrationId: string | undefined) {
  if (integrationId) {
    const byId = await db.query.integrations.findFirst({
      where: eq(integrations.id, integrationId as never),
    })
    if (byId?.secrets) return byId
  }
  return db.query.integrations.findFirst({
    where: and(eq(integrations.integrationType, 'github'), eq(integrations.status, 'active')),
  })
}

type IssueTarget =
  | {
      ok: true
      ownerRepo: string
      issueNumber: string
      accessToken: string
      integrationId: string
    }
  | { ok: false; error: string }

async function resolveIssueTarget(
  conversationId: AgentMessageDeliveryCtx['conversationId']
): Promise<IssueTarget> {
  const thread = await lookupChannelThreadByConversation(conversationId)
  if (!thread) {
    log.warn({ conversation_id: conversationId }, 'unreachable on GitHub: no channel thread')
    return { ok: false, error: 'This conversation is not linked to a GitHub issue.' }
  }
  const parsed = parseGitHubThreadKey(thread.externalThreadKey)
  if (!parsed) {
    log.warn(
      { conversation_id: conversationId, thread_key: thread.externalThreadKey },
      'unreachable on GitHub: malformed thread key'
    )
    return { ok: false, error: 'This conversation is not linked to a GitHub issue.' }
  }
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, thread.channelAccountId))
    .limit(1)
  const integrationId = (account?.config as { integrationId?: string } | undefined)?.integrationId
  const integration = await loadGitHubIntegration(integrationId)
  if (!integration?.secrets) {
    log.warn({ conversation_id: conversationId }, 'unreachable on GitHub: no access token')
    return { ok: false, error: 'GitHub is not connected.' }
  }
  const secrets = decryptSecrets(integration.secrets)
  const accessToken = secrets.accessToken as string | undefined
  if (!accessToken) {
    log.warn({ conversation_id: conversationId }, 'unreachable on GitHub: no access token')
    return { ok: false, error: 'GitHub is not connected.' }
  }
  return { ok: true, ...parsed, accessToken, integrationId: integration.id }
}

async function postIssueComment(
  accessToken: string,
  ownerRepo: string,
  issueNumber: string,
  body: string
): Promise<string | null> {
  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: githubHeaders(accessToken),
    body: JSON.stringify({ body }),
  })
  if (!response.ok) {
    const status = response.status
    const errorBody = await response.text()
    if (status === 401) {
      throw issueError('Authentication failed. Please reconnect GitHub.', {
        retryable: false,
        status,
      })
    }
    if (status === 404) {
      throw issueError(`Repository "${ownerRepo}" not found or not accessible.`, {
        retryable: false,
        status,
      })
    }
    if (status === 422) {
      throw issueError(`Validation error: ${errorBody}`, { retryable: false, status })
    }
    if (status === 429) {
      throw issueError('Rate limited by GitHub API.', { retryable: true, status })
    }
    throw issueError(`HTTP ${status}: ${errorBody}`, { status })
  }
  const comment = (await response.json()) as { id?: number }
  return comment.id != null ? String(comment.id) : null
}

async function markDelivery(
  ctx: AgentMessageDeliveryCtx,
  patch: { status: 'sent' | 'failed'; externalId?: string; error?: string }
): Promise<void> {
  if (!ctx.messageId) return
  await persistChannelDelivery(ctx.messageId, {
    status: patch.status,
    channel: 'github',
    externalId: patch.externalId,
    error: patch.error,
  }).catch((err) =>
    log.warn(
      { err, conversation_id: ctx.conversationId },
      'failed to persist GitHub delivery status'
    )
  )
}

const postedThisInvocation = new Set<string>()

export async function deliverGitHubAgentMessage(ctx: AgentMessageDeliveryCtx): Promise<void> {
  const dedupeKey = `${ctx.conversationId}:${ctx.messageId ?? ctx.direction}`
  if (postedThisInvocation.has(dedupeKey)) return
  postedThisInvocation.add(dedupeKey)
  try {
    const target = await resolveIssueTarget(ctx.conversationId)
    if (!target.ok) {
      await markDelivery(ctx, { status: 'failed', error: target.error })
      return
    }
    const body = contentJsonToMarkdown(ctx.contentJson, ctx.content)
    try {
      const commentId = await postIssueComment(
        target.accessToken,
        target.ownerRepo,
        target.issueNumber,
        body
      )
      if (commentId) {
        await markDelivery(ctx, { status: 'sent', externalId: commentId })
      } else {
        await markDelivery(ctx, { status: 'failed', error: 'Could not send to GitHub.' })
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Could not send to GitHub.'
      if (
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        (err as { status?: number }).status === 401
      ) {
        await noteAuthFailure(target.integrationId)
      }
      await markDelivery(ctx, { status: 'failed', error })
      throw err
    }
  } finally {
    // After this delivery settles, keep the key until the next macrotask so
    // sequential participant fan-out in the same notify invocation no-ops.
    setTimeout(() => postedThisInvocation.delete(dedupeKey), 0)
  }
}

async function patchIssueState(
  accessToken: string,
  ownerRepo: string,
  issueNumber: string,
  state: 'open' | 'closed'
): Promise<void> {
  const response = await fetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: githubHeaders(accessToken),
    body: JSON.stringify({ state }),
  })
  if (!response.ok) {
    const status = response.status
    const errorBody = await response.text()
    if (status === 401) {
      throw issueError('Authentication failed. Please reconnect GitHub.', {
        retryable: false,
        status,
      })
    }
    if (status === 404) {
      throw issueError(`Repository "${ownerRepo}" not found or not accessible.`, {
        retryable: false,
        status,
      })
    }
    throw issueError(`HTTP ${status}: ${errorBody}`, { status })
  }
}

export async function deliverGitHubLifecycleComment(
  kind: LifecycleKind,
  ctx: LifecycleDeliveryCtx
): Promise<void> {
  const target = await resolveIssueTarget(ctx.conversationId)
  if (!target.ok) return
  try {
    await patchIssueState(
      target.accessToken,
      target.ownerRepo,
      target.issueNumber,
      kind === 'reopened' ? 'open' : 'closed'
    )
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status?: number }).status === 401
    ) {
      await noteAuthFailure(target.integrationId)
    }
    throw err
  }
}

export async function deleteGitHubIssueComment(
  conversationId: AgentMessageDeliveryCtx['conversationId'],
  githubCommentId: string
): Promise<void> {
  const target = await resolveIssueTarget(conversationId)
  if (!target.ok) return
  const response = await fetch(
    `${GITHUB_API}/repos/${target.ownerRepo}/issues/comments/${githubCommentId}`,
    { method: 'DELETE', headers: githubHeaders(target.accessToken) }
  )
  if (response.ok || response.status === 404) return
  if (response.status === 401) {
    await noteAuthFailure(target.integrationId)
    throw issueError('Authentication failed. Please reconnect GitHub.', {
      retryable: false,
      status: 401,
    })
  }
  const errorBody = await response.text()
  throw issueError(`HTTP ${response.status}: ${errorBody}`, { status: response.status })
}

export async function retryGitHubAgentMessage(ctx: AgentMessageDeliveryCtx): Promise<void> {
  postedThisInvocation.delete(`${ctx.conversationId}:${ctx.messageId ?? ctx.direction}`)
  if (ctx.messageId) {
    await persistChannelDelivery(ctx.messageId, { status: 'pending', channel: 'github' })
  }
  const target = await resolveIssueTarget(ctx.conversationId)
  if (!target.ok) {
    await markDelivery(ctx, { status: 'failed', error: target.error })
    throw new Error(target.error)
  }
  await deliverGitHubAgentMessage(ctx)
}
