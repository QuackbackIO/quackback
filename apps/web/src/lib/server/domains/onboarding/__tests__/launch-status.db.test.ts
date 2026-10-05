/**
 * The launch plan's inputs as the plan reads them: a private team plan points
 * at the team board the win is judged on, not at a public board.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import type { BoardAccess } from '@/lib/shared/db-types'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, principal, settings, user, type SetupState } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/assistant')>()),
  isAssistantConfigured: () => false,
}))

import { loadLaunchStatus } from '../launch-status'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

const TEAM_ACCESS: BoardAccess = {
  view: 'team',
  vote: 'team',
  comment: 'team',
  submit: 'team',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

it('names the team board a private plan is judged on, apart from any public board', async () => {
  const [, , team] = await testDb
    .insert(boards)
    .values([
      { name: 'Feedback', slug: `feedback-${createId('board').slice(-6)}` },
      { name: 'Leadership', slug: `leaders-${createId('board').slice(-6)}`, access: TEAM_ACCESS },
      { name: 'Team ideas', slug: `team-${createId('board').slice(-6)}`, access: TEAM_ACCESS },
    ])
    .returning()
  const state: SetupState = {
    version: 2,
    goals: ['product_feedback'],
    feedbackPrivate: true,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'internal',
        resourceType: 'board',
        resourceId: team!.id,
        source: 'wizard',
        resolution: 'created',
        completedAt: '2026-10-01T07:00:00.000Z',
      },
    },
  }
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: new Date(),
    setupState: JSON.stringify(state),
  })
  const userId = createId('user') as UserId
  const owner = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Sam', email: `${userId}@acme.example` })
  await testDb
    .insert(principal)
    .values({ id: owner, userId, role: 'admin', type: 'user', createdAt: new Date() })

  const status = await loadLaunchStatus({ principalId: owner, role: 'admin', permissions: [] })
  expect(status.teamBoardSlug).toBe(team!.slug)
  expect(status.publicBoardSlug).not.toBe(team!.slug)
})

it('has no team board to name for a public feedback plan', async () => {
  await testDb.insert(boards).values({
    name: 'Leadership',
    slug: `leaders-${createId('board').slice(-6)}`,
    access: TEAM_ACCESS,
  })
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: new Date(),
    setupState: JSON.stringify({
      version: 2,
      goals: ['product_feedback'],
      steps: { core: true, workspace: true, startingPoint: null },
    }),
  })
  const status = await loadLaunchStatus({
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    permissions: [],
  })
  expect(status.teamBoardSlug).toBeNull()
})
