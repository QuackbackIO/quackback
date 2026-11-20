/**
 * The launch plan's inputs as the plan reads them: a private team plan points
 * at the team board the win is judged on, not at a public board.
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import type { BoardAccess } from '@/lib/shared/db-types'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { boards, integrations, principal, settings, user, type SetupState } from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/domains/assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/assistant')>()),
  isAssistantConfigured: () => false,
}))
// The widget config read resolves storage URLs once a logo is set; it is not under test.
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: async () => ({ enabled: false }),
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

  const status = await loadLaunchStatus({
    principalId: owner,
    email: `${userId}@acme.example`,
    role: 'admin',
    permissions: [],
  })
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
    email: null,
    role: 'admin',
    permissions: [],
  })
  expect(status.teamBoardSlug).toBeNull()
})

async function hasIntegrationWith(status: string | null): Promise<boolean> {
  await testDb.delete(integrations)
  if (status) {
    await testDb.insert(integrations).values({ integrationType: 'linear', status, config: {} })
  }
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    name: 'Acme',
    slug: `acme-${createId('workspace')}`,
    createdAt: new Date(),
  })
  const launch = await loadLaunchStatus({
    principalId: createId('principal') as PrincipalId,
    email: null,
    role: 'admin',
    permissions: [],
  })
  return launch.hasIntegration
}

it('counts an active or paused integration toward the connect step, not a pending one', async () => {
  expect(await hasIntegrationWith(null)).toBe(false)
  expect(await hasIntegrationWith('pending')).toBe(false)
  expect(await hasIntegrationWith('active')).toBe(true)
  expect(await hasIntegrationWith('paused')).toBe(true)
})

async function workspace(values: Partial<typeof settings.$inferInsert> = {}) {
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
    ...values,
  })
}

/** A caller as the status function is handed one: resolved already, email included. */
async function person(email: (id: string) => string) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Sam', email: email(userId) })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return { principalId, email: email(userId) }
}

const load = (
  caller: { principalId: PrincipalId; email: string | null },
  permissions: PermissionKey[] = []
) => loadLaunchStatus({ ...caller, role: 'admin', permissions })

it('counts the brand step done by the icon or by the header logo alone', async () => {
  const owner = await person((id) => `${id}@acme.example`)
  await workspace()
  expect((await load(owner)).hasBranding).toBe(false)
  await workspace({ headerLogoKey: 'logos/wide.png' })
  expect((await load(owner)).hasBranding).toBe(true)
  await workspace({ logoKey: 'logos/icon.png' })
  expect((await load(owner)).hasBranding).toBe(true)
})

it("offers the company website behind the caller's work email, as its registrable domain", async () => {
  await workspace()
  const owner = await person((id) => `${id}@mail.acme.example`)
  expect((await load(owner)).brandDomain).toBe('acme.example')
})

it('has no website to offer for a personal, relay or academic email', async () => {
  await workspace()
  for (const domain of ['gmail.com', 'abc.privaterelay.appleid.com', 'cs.ox.ac.uk']) {
    const owner = await person((id) => `${id}@${domain}`)
    expect((await load(owner)).brandDomain, domain).toBeNull()
  }
})

it('offers the website already looked up for the workspace before the caller’s own', async () => {
  await workspace({
    metadata: JSON.stringify({
      brandingLookup: {
        version: 1,
        status: 'failed',
        domain: 'widgets.example',
        claimId: '8f14e45f-ceea-467f-a9f8-1d0a6a1c3b7e',
        ownerPrincipalId: 'principal_1',
        startedAt: '2026-11-01T10:00:00.000Z',
        completedAt: '2026-11-01T10:00:05.000Z',
      },
    }),
  })
  const teammate = await person((id) => `${id}@gmail.com`)
  expect((await load(teammate)).brandDomain).toBe('widgets.example')
})

it('says where the published look was imported from, until it is customised by hand', async () => {
  const owner = await person((id) => `${id}@acme.example`)
  await workspace({ metadata: JSON.stringify({ brandImport: { host: 'acme.example' } }) })
  expect((await load(owner)).brandImportedFrom).toBe('acme.example')
  await workspace({ metadata: JSON.stringify({ brandImport: null }) })
  expect((await load(owner)).brandImportedFrom).toBeNull()
  await workspace({ metadata: JSON.stringify({ brandImport: { host: '<b>not a host</b>' } }) })
  expect((await load(owner)).brandImportedFrom).toBeNull()
})

it('lets the brand step act only for someone who may open Customise', async () => {
  await workspace()
  const owner = await person((id) => `${id}@acme.example`)
  expect((await load(owner, [])).permissions.brandingManage).toBe(false)
  expect((await load(owner, [PERMISSIONS.SETTINGS_BRANDING])).permissions.brandingManage).toBe(true)
})
