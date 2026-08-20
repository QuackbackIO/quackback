/**
 * Two doors, two answers, one workspace.
 *
 * A provisioned workspace is seeded with `authConfig.openSignup: false` AND
 * `portalConfig.openSignup: true`, deliberately and in the same breath: anyone
 * may open an account to leave feedback, and nobody joins the team without an
 * invitation. Those two values are not in conflict — they are answers to two
 * different questions, and a policy that reads one of them for both doors
 * silently applies the team's answer to the public portal.
 *
 * ## Why this suite goes near a real database
 *
 * The whole defect is WHICH STORED FIELD is consulted. A double that hands the
 * policy `{ openSignup: X }` cannot express the difference — it has already
 * collapsed the two fields into one before the code under test runs, so it
 * passes against a policy reading either field, or a policy reading neither.
 * (`email-signin-signup-gate.test.ts` and the `openSignup` cases in
 * `hooks-before.test.ts` are exactly that shape; that is why neither can see
 * this.)
 *
 * So nothing between the stored columns and the decision is stubbed. A real
 * `settings` row carries both configs, the real `getWorkspaceSettings` reads
 * them back through the real `parseJsonConfig`, and the real policy decides.
 * The only substitution is the connection: `db` points at the fixture's
 * rolled-back transaction.
 *
 * ## The fixture is a transcription, and that is a liability worth naming
 *
 * The two config blobs below are transcribed from the provisioner's seed
 * builders in the control plane, which this repository cannot import. If those
 * seeds ever change shape, nothing here notices — so the first case asserts
 * what the workspace REPORTS rather than what was inserted, which at least
 * fails loudly if the read stops telling the two answers apart.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, principal, user, invitation } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// The cache these reads pass through. Nothing under test, and a hit would let
// one case answer another's question.
vi.mock('@/lib/server/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))

const { isAccountCreationAllowed } = await import('../signup-policy')
const { getWorkspaceSettings, updatePortalConfig } =
  await import('@/lib/server/domains/settings/settings.service')
// The validator the admin write actually passes through. Imported rather than
// restated: a test that hand-built the input would pass while the only supported
// writer silently dropped the key, which is exactly what it did.
const { updatePortalConfigSchema } = await import('@/lib/server/functions/settings')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
    await db.select({ id: invitation.id }).from(invitation).limit(0)
    await db.select({ id: principal.id }).from(principal).limit(0)
  },
})

/**
 * What a provisioned workspace's two config columns hold, transcribed from the
 * control plane's seed builders. Password off, magic link on, and the one value
 * that differs between them: the team is invitation-only, the portal is not.
 */
const PROVISIONED_AUTH_CONFIG = {
  oauth: { google: true, github: true, password: false, magicLink: true },
  openSignup: false,
}
const PROVISIONED_PORTAL_CONFIG = {
  oauth: { google: true, github: true, password: false, magicLink: true },
  openSignup: true,
}

async function seedWorkspace(
  opts: {
    authConfig?: Record<string, unknown> | null
    portalConfig?: Record<string, unknown> | null
  } = {}
): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    // The stamp a provisioner leaves, in the bag shape every database has.
    // Without it the workspace reads as claimable and the bootstrap exemption
    // would answer every case below with "yes" for reasons of its own.
    metadata: JSON.stringify({
      cloudTenant: { v: 1, workspaceKey: 'ws_acme', stampedAt: '2026-01-01T00:00:00.000Z' },
    }),
    authConfig: opts.authConfig === undefined ? null : JSON.stringify(opts.authConfig),
    portalConfig: opts.portalConfig === undefined ? null : JSON.stringify(opts.portalConfig),
  })
}

async function seedUser(email: string): Promise<UserId> {
  const id = createId('user') as UserId
  await testDb.insert(user).values({
    id,
    name: email.split('@')[0],
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

/** Somebody owns this workspace, so no bootstrap exemption is in play. */
async function seedOwner(email: string): Promise<void> {
  const userId = await seedUser(email)
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'admin',
    type: 'user',
    createdAt: new Date(),
  })
}

async function seedInvite(email: string, kind: 'team' | 'portal' = 'team'): Promise<void> {
  const inviterId = await seedUser(`inviter-${Math.random().toString(36).slice(2, 8)}@acme.example`)
  await testDb.insert(invitation).values({
    id: createId('invite'),
    email,
    status: 'pending',
    kind,
    role: 'member',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    inviterId,
  })
}

const STRANGER = 'stranger@example.com'

describe.skipIf(!fixture.available)('openSignup, per audience', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('a workspace seeded the way a provisioner seeds one', () => {
    beforeEach(async () => {
      await seedWorkspace({
        authConfig: PROVISIONED_AUTH_CONFIG,
        portalConfig: PROVISIONED_PORTAL_CONFIG,
      })
      await seedOwner('owner@acme.example')
    })

    // The fixture guard. Everything below is meaningless if the read collapses
    // the two answers into one before the policy ever sees them.
    it('reports the two answers apart', async () => {
      const workspace = await getWorkspaceSettings()

      expect(workspace?.authConfig.openSignup).toBe(false)
      expect(workspace?.portalConfig.openSignup).toBe(true)
    })

    // The signup funnel. Every new customer of every provisioned workspace
    // arrives through this question.
    it('lets a member of the public open a portal account', async () => {
      expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(true)
    })

    // The other half of the same seed, and the control that keeps the case
    // above from meaning "the gate is off": one argument different, same row,
    // same workspace, opposite answer.
    it('still refuses that same stranger a place on the team', async () => {
      expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(false)
    })

    // The write half of the pair. The portal's answer is a key the app itself
    // never writes, and every portal settings save rewrites the whole column —
    // so a writer that reconstructed the config from known keys would drop it
    // and close the portal on the first admin to touch an unrelated toggle.
    it('survives an admin saving unrelated portal settings', async () => {
      await updatePortalConfig({ features: { allowAnonymous: false } })

      expect((await getWorkspaceSettings())?.portalConfig.openSignup).toBe(true)
      expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(true)
    })
  })

  /**
   * The write half.
   *
   * A setting the portal reads and nothing writes is not a setting: on a
   * workspace seeded with the portal open, an administrator who wants it closed
   * has to be able to say so, and the only save that reaches this column is
   * `updatePortalConfigFn`. Its validator is a `z.object`, which STRIPS keys it
   * does not name — so an omission there is silent by construction, and the
   * request looks accepted while nothing changes.
   *
   * Driven through the real validator and the real service, then read back
   * through the real policy: a test that called the service with a hand-built
   * object would prove nothing about what the endpoint accepts.
   */
  describe('an administrator closing the portal', () => {
    beforeEach(async () => {
      await seedWorkspace({
        authConfig: PROVISIONED_AUTH_CONFIG,
        portalConfig: PROVISIONED_PORTAL_CONFIG,
      })
      await seedOwner('owner@acme.example')
    })

    it('takes the answer and refuses the public afterwards', async () => {
      await updatePortalConfig(updatePortalConfigSchema.parse({ openSignup: false }))

      expect((await getWorkspaceSettings())?.portalConfig.openSignup).toBe(false)
      expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)
    })

    // The control: the same writer puts it back. Both halves are asserted, so
    // this cannot be satisfied by a writer that changes nothing at all.
    it('opens it again', async () => {
      await updatePortalConfig(updatePortalConfigSchema.parse({ openSignup: false }))
      expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)

      await updatePortalConfig(updatePortalConfigSchema.parse({ openSignup: true }))
      expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(true)
    })
  })

  // Two doors, two saves. Closing the portal must not reach across to the
  // team's answer, or the writer would be the same collapse the read half was
  // fixed for. Seeded with the team OPEN so that "unchanged" is a value this
  // save could plausibly have clobbered.
  it('closes the portal without closing the team', async () => {
    await seedWorkspace({
      authConfig: { openSignup: true },
      portalConfig: { openSignup: true },
    })
    await seedOwner('owner@acme.example')

    await updatePortalConfig(updatePortalConfigSchema.parse({ openSignup: false }))

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(true)
  })

  // The divergence driven the other way, so that "the portal door reads the
  // portal's answer" cannot be satisfied by a policy that merely lets either
  // `true` win. A workspace that closed its portal and left team sign-ups open
  // is refused at the portal.
  it('refuses at the portal when the portal is the one that said no', async () => {
    await seedWorkspace({
      authConfig: { openSignup: true },
      portalConfig: { openSignup: false },
    })
    await seedOwner('owner@acme.example')

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(true)
  })

  // A workspace nobody has answered the portal's question for: the wizard
  // writes the workspace-wide key and no portal one. The portal must keep
  // obeying that single answer until somebody gives it one of its own.
  it('falls back to the workspace answer when the portal has none', async () => {
    await seedWorkspace({ authConfig: { openSignup: false }, portalConfig: { access: {} } })
    await seedOwner('owner@acme.example')

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(false)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(false)
  })

  // A workspace nobody has configured at all answers both doors the way the
  // whole installed base has always behaved.
  it('leaves both doors open on a workspace that stored no answer', async () => {
    await seedWorkspace()
    await seedOwner('owner@acme.example')

    expect(await isAccountCreationAllowed(STRANGER, 'portal')).toBe(true)
    expect(await isAccountCreationAllowed(STRANGER, 'team')).toBe(true)
  })

  // The exemptions are facts about the address, not about a door, so they hold
  // whichever door is asked. Both cases stay green in every version of this
  // policy — they are here so that a refusal above cannot be explained by a
  // gate that refuses everyone.
  describe('the exemptions do not vary by audience', () => {
    beforeEach(async () => {
      await seedWorkspace({
        authConfig: PROVISIONED_AUTH_CONFIG,
        portalConfig: { openSignup: false },
      })
      await seedOwner('owner@acme.example')
    })

    it('lets an address that already holds an account through either door', async () => {
      await seedUser('regular@acme.example')

      expect(await isAccountCreationAllowed('regular@acme.example', 'portal')).toBe(true)
      expect(await isAccountCreationAllowed('regular@acme.example', 'team')).toBe(true)
    })

    it('lets an invited address through either door', async () => {
      await seedInvite('newhire@acme.example')

      expect(await isAccountCreationAllowed('newhire@acme.example', 'portal')).toBe(true)
      expect(await isAccountCreationAllowed('newhire@acme.example', 'team')).toBe(true)
    })
  })
})
