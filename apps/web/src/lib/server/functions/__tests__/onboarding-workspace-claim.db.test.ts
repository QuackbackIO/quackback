/**
 * Real-Postgres coverage for the signal the first screen branches on.
 *
 * The two fixtures are deliberately unalike, because the defect this closes
 * survived a fixture set where every workspace looked the same: a workspace
 * that arrives with an owner already seeded, and an install that starts
 * empty. The query has to tell them apart against the live schema, including
 * the `type: 'user'` filter that keeps service principals from reading as
 * owners.
 *
 * Every write rolls back with the fixture transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

// getSettings() caches through Redis in production; read the row the fixture
// actually seeded so the setup-state branch is exercised, not stubbed.
const hoisted = vi.hoisted(() => ({ getSettings: vi.fn() }))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: hoisted.getSettings }))

import { getWorkspaceClaimFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id, email: user.email }).from(user).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const OWNER_EMAIL = 'jane.doe@acme.example'

/** The setup state a workspace carries before anyone finishes the wizard. */
const UNFINISHED_SETUP = JSON.stringify({
  version: 2,
  steps: { core: true, workspace: false, startingPoint: null },
})

/** A finished wizard. The starting point carries every field the shared
 *  normalizer requires; a short-cut shape here normalizes back to null and
 *  the workspace would silently read as unfinished. */
const FINISHED_SETUP = JSON.stringify({
  version: 2,
  steps: {
    core: true,
    workspace: true,
    startingPoint: {
      outcome: 'product_feedback',
      resourceType: 'board',
      source: 'wizard',
      resolution: 'created',
      completedAt: '2026-08-01T00:00:00.000Z',
    },
  },
  useCase: 'product_feedback',
  activationHandoffSeenAt: '2026-08-01T00:00:00.000Z',
})

async function seedUser(email: string): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({
    id,
    name: 'Jane Doe',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function seedPrincipal(input: {
  userId?: UserId
  role: string
  type: string
}): Promise<PrincipalId> {
  const id = createId('principal') as PrincipalId
  await testDb.insert(principal).values({
    id,
    userId: input.userId ?? null,
    role: input.role as 'admin' | 'member' | 'user',
    type: input.type as 'user' | 'service',
    createdAt: new Date(),
  })
  return id
}

describe.skipIf(!fixture.available)('getWorkspaceClaimFn', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    hoisted.getSettings.mockResolvedValue({ setupState: UNFINISHED_SETUP })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  // This payload is dehydrated into an unauthenticated SSR document that anyone
  // who can guess the hostname can fetch with no cookie and no CSRF header, so
  // the assertion is on the payload's whole surface, not on one field: the
  // owner's address, their local part, and their employer's domain all have to
  // be absent, and no key may be added later that carries them.
  it('reads a provisioned workspace as claimed without publishing its owner', async () => {
    const userId = await seedUser(OWNER_EMAIL)
    await seedPrincipal({ userId, role: 'admin', type: 'user' })

    const claim = await getWorkspaceClaimFn()

    expect(claim).toEqual({ claimed: true, setupComplete: false })
    const wire = JSON.stringify(claim)
    expect(wire).not.toContain(OWNER_EMAIL)
    expect(wire).not.toContain('jane.doe')
    expect(wire).not.toContain('acme.example')
    expect(wire).not.toMatch(/\*{2,}\s*@/)
  })

  it('reads a self-hosted install with nobody seeded as unclaimed', async () => {
    const claim = await getWorkspaceClaimFn()

    expect(claim).toEqual({ claimed: false, setupComplete: false })
  })

  it('does not read a non-admin member as the owner', async () => {
    const userId = await seedUser('member@acme.example')
    await seedPrincipal({ userId, role: 'member', type: 'user' })

    await expect(getWorkspaceClaimFn()).resolves.toMatchObject({ claimed: false })
  })

  it('does not read a service principal as the owner', async () => {
    await seedPrincipal({ role: 'admin', type: 'service' })

    await expect(getWorkspaceClaimFn()).resolves.toMatchObject({ claimed: false })
  })

  it('still says nothing about the owner once setup is finished', async () => {
    hoisted.getSettings.mockResolvedValue({ setupState: FINISHED_SETUP })
    const userId = await seedUser(OWNER_EMAIL)
    await seedPrincipal({ userId, role: 'admin', type: 'user' })

    const claim = await getWorkspaceClaimFn()

    expect(claim).toEqual({ claimed: true, setupComplete: true })
  })

  // The claim tracks the principal, not the user row: an admin whose user row
  // is gone still owns setup, exactly as the bootstrap promoter still refuses
  // to hand it to anyone else.
  it('reports the claim even when the owner has no user row', async () => {
    await seedPrincipal({ role: 'admin', type: 'user' })

    const claim = await getWorkspaceClaimFn()

    expect(claim.claimed).toBe(true)
  })
})
