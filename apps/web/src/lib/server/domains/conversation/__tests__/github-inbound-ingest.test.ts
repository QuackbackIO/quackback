/**
 * GitHub inbox-channel ingest: human-opened issues become conversations;
 * bot/tracker-owned issues do not; comments append without reopening a closed
 * issue; issue closed/reopened syncs conversation status; comment ids
 * dedupe. Real DB, rolled back.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  createId,
  type IntegrationId,
  type PrincipalId,
  type TeamId,
  type UserId,
} from '@quackback/ids'

process.env.BASE_URL = 'https://quackback.test'
process.env.SECRET_KEY ||= 'x'.repeat(32)

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  teams,
  channelAccounts,
  conversations,
  conversationMessages,
  channelThreads,
  integrations,
  postExternalLinks,
  posts,
  boards,
  user,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('../conversation.webhooks', async (orig) => ({
  ...(await orig<typeof import('../conversation.webhooks')>()),
  emitConversationCreated: vi.fn().mockResolvedValue(undefined),
  emitMessageCreated: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/server/realtime/conversation-channels', () => ({
  publishConversationUpdate: vi.fn(),
  publishConversationEvent: vi.fn(),
  publishAgentConversationEvent: vi.fn(),
}))

import { ingestGitHubChannelEvent } from '../conversation.github-inbound'
import { githubThreadKey } from '@/lib/server/domains/channels/github-thread'
import {
  publishAgentConversationEvent,
  publishConversationEvent,
} from '@/lib/server/realtime/conversation-channels'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: channelAccounts.id }).from(channelAccounts).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

async function seedConnection() {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `T-${suffix()}` })
    .returning()
  const [account] = await testDb
    .insert(channelAccounts)
    .values({
      owningTeamId: team.id as TeamId,
      channel: 'github',
      role: 'connection',
      config: {},
    })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'github',
      status: 'active',
      config: { channelId: 'acme/api', username: 'acme-ops', webhookSecret: 's' },
    })
    .returning()
  return { account, integration }
}

function issuePayload(over: {
  action?: string
  number?: number
  login?: string
  userId?: number
  avatarUrl?: string
  title?: string
  body?: string
  comment?: { id: number; login: string; body: string; userId?: number; avatarUrl?: string }
}) {
  const number = over.number ?? 201
  const login = over.login ?? 'jane'
  return {
    action: over.action ?? 'opened',
    repository: { full_name: 'acme/api' },
    issue: {
      number,
      title: over.title ?? 'Widget is broken',
      body: over.body ?? 'Steps to reproduce.',
      html_url: `https://github.com/acme/api/issues/${number}`,
      user: { id: over.userId ?? 42, login, avatar_url: over.avatarUrl ?? null },
    },
    comment: over.comment
      ? {
          id: over.comment.id,
          body: over.comment.body,
          html_url: `https://github.com/acme/api/issues/${number}#issuecomment-${over.comment.id}`,
          user: {
            id: over.comment.userId ?? 99,
            login: over.comment.login,
            avatar_url: over.comment.avatarUrl ?? null,
          },
        }
      : undefined,
  }
}

describe.skipIf(!fixture.available)('github channel ingest (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => vi.clearAllMocks())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('opened by a human creates a github conversation and thread key', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })

    const [conv] = await testDb
      .select()
      .from(conversations)
      .where(eq(conversations.channel, 'github'))
    expect(conv).toBeTruthy()
    expect(conv.subject).toBe('Widget is broken')
    expect((conv.customAttributes as { githubUrl?: string }).githubUrl).toBe(
      'https://github.com/acme/api/issues/201'
    )
    const [thread] = await testDb.select().from(channelThreads)
    expect(thread.externalThreadKey).toBe(githubThreadKey('acme/api', 201))
  })

  it('opened by the connected username does not create a conversation', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ login: 'acme-ops' })),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const rows = await testDb.select().from(conversations)
    expect(rows).toHaveLength(0)
  })

  it('comment on a github-native issue appends without reopening a closed conversation', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const [conv] = await testDb.select().from(conversations)
    await testDb
      .update(conversations)
      .set({ status: 'closed', resolvedAt: new Date(), waitingSince: null })
      .where(eq(conversations.id, conv.id))

    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: { id: 555, login: 'jane', body: 'still broken' },
        })
      ),
      eventName: 'issue_comment',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })

    const [updated] = await testDb.select().from(conversations).where(eq(conversations.id, conv.id))
    expect(updated.status).toBe('closed')
    expect(updated.resolvedAt).not.toBeNull()
    const msgs = await testDb
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conv.id))
    expect(msgs.some((m) => m.metadata?.githubCommentId === '555')).toBe(true)
  })

  it('issues.closed closes the matching conversation', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const [conv] = await testDb.select().from(conversations)
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ action: 'closed' })),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const [updated] = await testDb.select().from(conversations).where(eq(conversations.id, conv.id))
    expect(updated.status).toBe('closed')
    expect(updated.resolvedAt).not.toBeNull()
  })

  it('issues.reopened reopens the matching conversation', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const [conv] = await testDb.select().from(conversations)
    await testDb
      .update(conversations)
      .set({ status: 'closed', resolvedAt: new Date() })
      .where(eq(conversations.id, conv.id))
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ action: 'reopened' })),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    const [updated] = await testDb.select().from(conversations).where(eq(conversations.id, conv.id))
    expect(updated.status).toBe('open')
    expect(updated.resolvedAt).toBeNull()
  })

  it('comment on a tracker-created issue with no channel thread is ignored', async () => {
    const { integration } = await seedConnection()
    const userId = createId('user') as UserId
    const principalId = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'Poster' })
    await testDb
      .insert(principal)
      .values({ id: principalId, userId, role: 'user', type: 'user', createdAt: new Date() })
    const [board] = await testDb
      .insert(boards)
      .values({ slug: `b_${suffix()}`, name: 'B' })
      .returning()
    const [post] = await testDb
      .insert(posts)
      .values({ boardId: board.id, title: 'P', content: 'c', principalId })
      .returning()
    await testDb.insert(postExternalLinks).values({
      postId: post.id,
      integrationType: 'github',
      externalId: '88',
    })

    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          number: 88,
          login: 'acme-ops',
          comment: { id: 9, login: 'stranger', body: 'hi' },
        })
      ),
      eventName: 'issue_comment',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    expect(await testDb.select().from(conversations)).toHaveLength(0)
  })

  it('same githubCommentId twice inserts one message', async () => {
    const { integration } = await seedConnection()
    const payload = issuePayload({
      action: 'created',
      comment: { id: 777, login: 'jane', body: 'ping' },
    })
    const event = {
      body: JSON.stringify(payload),
      eventName: 'issue_comment' as const,
      integration: { id: integration.id as IntegrationId, config: integration.config },
    }
    await ingestGitHubChannelEvent(event)
    await ingestGitHubChannelEvent(event)
    const msgs = await testDb.select().from(conversationMessages)
    const withId = msgs.filter((m) => m.metadata?.githubCommentId === '777')
    expect(withId).toHaveLength(1)
  })

  it('skips an opened issue when the login differs only by case from the connected username', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ login: 'Acme-Ops' })),
      eventName: 'issues',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    expect(await testDb.select().from(conversations)).toHaveLength(0)
  })

  it('issue_comment.edited updates the matching body and publishes message_updated', async () => {
    const { integration } = await seedConnection()
    const integrationRef = { id: integration.id as IntegrationId, config: integration.config }
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: { id: 555, login: 'jane', body: 'still broken' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'edited',
          comment: { id: 555, login: 'jane', body: 'still broken, edited' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })

    const msgs = await testDb.select().from(conversationMessages)
    const edited = msgs.find((m) => m.metadata?.githubCommentId === '555')
    expect(edited?.content).toBe('still broken, edited')
    expect(publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'message_updated',
        message: expect.objectContaining({ id: edited?.id }),
      })
    )
  })

  it('issue_comment.deleted hides the matching bubble', async () => {
    const { integration } = await seedConnection()
    const integrationRef = { id: integration.id as IntegrationId, config: integration.config }
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({})),
      eventName: 'issues',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: { id: 556, login: 'jane', body: 'remove me' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'deleted',
          comment: { id: 556, login: 'jane', body: 'remove me' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })

    const msgs = await testDb.select().from(conversationMessages)
    const deleted = msgs.find((m) => m.metadata?.githubCommentId === '556')
    expect(deleted?.deletedAt).not.toBeNull()
    expect(publishAgentConversationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message_deleted', messageId: deleted?.id })
    )
  })

  it('issue_comment.edited with no matching row does not create a conversation', async () => {
    const { integration } = await seedConnection()
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'edited',
          comment: { id: 1, login: 'jane', body: 'ghost' },
        })
      ),
      eventName: 'issue_comment',
      integration: { id: integration.id as IntegrationId, config: integration.config },
    })
    expect(await testDb.select().from(conversations)).toHaveLength(0)
    expect(await testDb.select().from(conversationMessages)).toHaveLength(0)
  })

  it('two commenters resolve to two principals', async () => {
    const { integration } = await seedConnection()
    const integrationRef = { id: integration.id as IntegrationId, config: integration.config }
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ login: 'jane', userId: 42 })),
      eventName: 'issues',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: { id: 10, login: 'bob', userId: 100, body: 'also seeing this' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: { id: 11, login: 'alice', userId: 101, body: 'plus this' },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })

    const msgs = await testDb.select().from(conversationMessages)
    const principalIds = new Set(msgs.map((m) => m.principalId))
    expect(principalIds.size).toBe(3)
    expect(publishConversationEvent).toHaveBeenCalled()
  })

  it('stores the GitHub avatar on the principal when a later comment includes it', async () => {
    const { integration } = await seedConnection()
    const integrationRef = { id: integration.id as IntegrationId, config: integration.config }
    await ingestGitHubChannelEvent({
      body: JSON.stringify(issuePayload({ login: 'jane', userId: 42 })),
      eventName: 'issues',
      integration: integrationRef,
    })
    await ingestGitHubChannelEvent({
      body: JSON.stringify(
        issuePayload({
          action: 'created',
          comment: {
            id: 12,
            login: 'jane',
            userId: 42,
            body: 'screenshot attached',
            avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4',
          },
        })
      ),
      eventName: 'issue_comment',
      integration: integrationRef,
    })
    const [conv] = await testDb.select().from(conversations)
    const [person] = await testDb
      .select()
      .from(principal)
      .where(eq(principal.id, conv.visitorPrincipalId))
    expect(person.avatarUrl).toBe('https://avatars.githubusercontent.com/u/42?v=4')
  })
})
