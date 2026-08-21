/**
 * The workspace the enforcement of `openSignup` nearly locked out: one nobody
 * ran the wizard on.
 *
 * `config-file/deps.ts::createSettings` is the insert a control-plane-provisioned
 * workspace gets, and it writes no `authConfig` column at all. Nothing was wrong
 * with that while the setting bound nothing on the server. The moment it became
 * binding, the value that row REPORTS — read the way every server path reads it,
 * through `parseJsonConfig(row.authConfig, DEFAULT_AUTH_CONFIG)` — became the
 * workspace's policy, and it was a policy nobody chose. With an owner recorded,
 * that closes the public portal of every provisioned workspace forever.
 *
 * So the composition is what is under test, not any one of its three parts: the
 * REAL insert, the REAL derivation, and the REAL policy in a row. A test that
 * stubbed the middle step would be asserting that a default equals itself.
 *
 * `getWorkspaceSettings` is the one thing supplied, and it is supplied with the
 * object the real derivation just produced — so the policy still decides on a
 * value this file did not choose.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, principal, user, invitation, sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const hoisted = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))

// The caches these two modules reach for on write. Nothing under test.
vi.mock('@/lib/server/domains/settings/settings.helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.helpers')>()),
  invalidateSettingsCache: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  invalidateTierLimitsCache: vi.fn(),
}))

const { isAccountCreationAllowed } = await import('../signup-policy')
const { makeReconcileDeps } = await import('@/lib/server/config-file/deps')
const { parseJsonConfig } = await import('@/lib/server/domains/settings/settings.helpers')
const { DEFAULT_AUTH_CONFIG } = await import('@/lib/server/domains/settings/settings.types')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
    await db.select({ id: invitation.id }).from(invitation).limit(0)
    // Migration 0258's column, probed rather than created. `ALTER TABLE` from
    // inside the fixture's transaction would hold ACCESS EXCLUSIVE on
    // `settings` for the whole test, and two suites doing that at once deadlock.
    await db.execute(sql`select cloud_workspace_key from settings limit 0`)
  },
})

/** The insert a provisioned workspace really gets, run through the real code. */
async function provisionWorkspace(): Promise<void> {
  await makeReconcileDeps().createSettings({
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    managedFieldPaths: ['name'],
  } as unknown as Parameters<ReturnType<typeof makeReconcileDeps>['createSettings']>[0])
  await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = 'ws_acme'`)
}

/** What the server believes about this workspace's auth config. */
async function derivedAuthConfig() {
  const row = await testDb.query.settings.findFirst()
  return parseJsonConfig(row?.authConfig ?? null, DEFAULT_AUTH_CONFIG)
}

async function seedOwner(email: string): Promise<void> {
  const userId = createId('user') as UserId
  await testDb.insert(user).values({
    id: userId,
    name: 'Owner',
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
}

describe.skipIf(!fixture.available)('a provisioned workspace nobody configured', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('writes no authConfig at all', async () => {
    await provisionWorkspace()

    const row = await testDb.query.settings.findFirst()
    expect(row?.authConfig).toBeNull()
  })

  // The step the defect lived in. A row with no stored answer must not report
  // one that the whole installed base has never behaved as.
  it('reports openSignup as open, because that is what it has always done', async () => {
    await provisionWorkspace()

    expect((await derivedAuthConfig()).openSignup).toBe(true)
  })

  // The three steps composed. This is the customer-visible fact: somebody can
  // still open a portal account on a workspace a control plane provisioned and
  // an owner has since claimed.
  it('still lets a member of the public open a portal account once it has an owner', async () => {
    await provisionWorkspace()
    await seedOwner('owner@acme.example')
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: await derivedAuthConfig() })

    expect(await isAccountCreationAllowed('someone@example.com', 'portal')).toBe(true)
  })

  // The control that keeps the case above from being "the gate is off". A
  // workspace that answered the question is obeyed, and the answer travels
  // through exactly the same three steps.
  it('obeys the same workspace once somebody actually closes sign-ups', async () => {
    await provisionWorkspace()
    await seedOwner('owner@acme.example')
    await testDb.execute(
      sql`UPDATE settings SET auth_config = ${JSON.stringify({ openSignup: false })}`
    )
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: await derivedAuthConfig() })

    expect((await derivedAuthConfig()).openSignup).toBe(false)
    expect(await isAccountCreationAllowed('someone@example.com', 'portal')).toBe(false)
  })

  // A stored config that says everything except this. `parseJsonConfig` merges
  // over the default, so an absent key is the same non-answer as an absent
  // column and must be treated the same way.
  it('treats a stored config with no openSignup key as no answer either', async () => {
    await provisionWorkspace()
    await seedOwner('owner@acme.example')
    await testDb.execute(
      sql`UPDATE settings SET auth_config = ${JSON.stringify({ oauth: { password: true } })}`
    )
    hoisted.getWorkspaceSettings.mockResolvedValue({ authConfig: await derivedAuthConfig() })

    expect(await isAccountCreationAllowed('someone@example.com', 'portal')).toBe(true)
  })
})
