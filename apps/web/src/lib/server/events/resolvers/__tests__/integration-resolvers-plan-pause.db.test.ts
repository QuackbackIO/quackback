/**
 * The integration sinks resolve no targets while integrations are paused after
 * the plan limits grace: outbound notifications and status pushes are not
 * queued. Mappings, links and connections are left as they are.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PostId, type PrincipalId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  integrationEventMappings,
  integrations,
  postExternalLinks,
  posts,
  postStatuses,
  principal,
  user,
} from '@/lib/server/db'
import type { DomainEvent } from '../../envelope'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
// The mapping cache is bypassed so each test reads its own rows.
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: async () => null,
  cacheSet: async () => undefined,
}))
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { integrationResolver } from '../integration.resolver'
import { remoteStatusPushResolver } from '../remote-status-push.resolver'
import {
  FEATURE_STATES,
  runsWithoutPlanGate,
  setFeatureState,
} from '@/lib/server/domains/plan-limits/__tests__/feature-states'

const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(fixture.rollback)
afterAll(fixture.close)

function event(type: string, entityId: string, payload: Record<string, unknown>): DomainEvent {
  return {
    id: createId('event'),
    type,
    entityId,
    actorType: 'user',
    actorId: undefined,
    payload,
  } as unknown as DomainEvent
}

async function seed() {
  const [person] = await testDb
    .insert(user)
    .values({ name: 'Acme person', email: `${createId('user')}@example.com` })
    .returning()
  const [author] = await testDb
    .insert(principal)
    .values({ userId: person.id, type: 'user', role: 'admin', createdAt: new Date() })
    .returning()
  const [status] = await testDb
    .insert(postStatuses)
    .values({ name: 'Acme done', slug: `acme-done-${createId('user')}` })
    .returning()
  const [board] = await testDb
    .insert(boards)
    .values({ name: 'Acme', slug: `acme-${createId('board')}` })
    .returning()
  const [post] = await testDb
    .insert(posts)
    .values({
      boardId: board.id,
      title: 'Acme idea',
      content: '',
      principalId: author.id as PrincipalId,
      statusId: status.id,
    })
    .returning()
  const [linear] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'linear',
      status: 'active',
      config: { channelId: 'team_1', pushStatusMappings: { [status.id]: 'Done' } },
    })
    .returning()
  await testDb.insert(integrationEventMappings).values({
    integrationId: linear.id,
    eventType: 'post.created',
    actionType: 'create_issue',
    enabled: true,
    actionConfig: { channelId: 'team_1' },
  })
  await testDb.insert(postExternalLinks).values({
    postId: post.id as PostId,
    integrationId: linear.id,
    integrationType: 'linear',
    externalId: 'LIN-1',
  })
  return { post, board }
}

describe.skipIf(!fixture.available)('integration resolvers and the plan limits pause', () => {
  it.each(FEATURE_STATES)('in the %s state', async (state) => {
    const { post, board } = await seed()
    setFeatureState(state, 'integrations')

    const notify = await integrationResolver.resolve(
      event('post.created', post.id, { post: { id: post.id, boardId: board.id } })
    )
    const push = await remoteStatusPushResolver.resolve(
      event('post.status_changed', post.id, { post: { id: post.id, boardId: board.id } })
    )

    const expected = runsWithoutPlanGate(state) ? 1 : 0
    expect(notify).toHaveLength(expected)
    expect(push).toHaveLength(expected)
  })
})

describe.skipIf(!fixture.available)('notification-only events never reach an integration', () => {
  it('a mapping naming a comment mention gets nothing, private or not', async () => {
    const { post, board } = await seed()
    setFeatureState('included', 'integrations')
    const [linear] = await testDb.select({ id: integrations.id }).from(integrations).limit(1)
    await testDb.insert(integrationEventMappings).values({
      integrationId: linear.id,
      eventType: 'comment.mentioned',
      actionType: 'send_message',
      enabled: true,
      actionConfig: { channelId: 'team_1' },
    })

    expect(integrationResolver.interestedIn('comment.mentioned')).toBe(false)
    for (const isPrivate of [true, false]) {
      const targets = await integrationResolver.resolve(
        event('comment.mentioned', post.id, {
          postId: post.id,
          boardId: board.id,
          commentId: createId('post_comment'),
          isPrivate,
          excerpt: 'internal words',
        })
      )
      expect(targets).toEqual([])
    }
  })
})
