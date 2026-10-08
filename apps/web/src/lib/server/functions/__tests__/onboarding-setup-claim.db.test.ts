/**
 * Who may run the workspace step, and when it stops running, against real
 * Postgres with the real role writer.
 *
 * The sibling guard suite (onboarding-bootstrap-claim.db.test.ts) stubs the
 * principal factory so a refusal can be told from a promotion by whether the
 * factory was reached. This one keeps the factory real and reads the outcome
 * back from the principal and settings tables: the question here is what the
 * workspace ends up with, not which branch ran.
 *
 * Every write rolls back with the fixture transaction.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, user, settings, eq, sql, getSetupState } from '@/lib/server/db'
import { mergeSetupState } from '@/lib/server/config-file/reconciler'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Runs the function's own validator, as the server does, so a direct call
// with input the form would never send is checked by the same schema.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown } | null = null
    const chain: Record<string, unknown> = {}
    chain.validator = (next: { parse: (value: unknown) => unknown }) => {
      schema = next
      return chain
    }
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign(
        async (args?: { data?: unknown }) =>
          handler({ data: schema ? schema.parse(args?.data) : args?.data }),
        chain
      )
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  isSetupOpenToClaim: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))

// Passed through to the real predicate for every test but one, which stands in
// for a save whose early check ran before another tab finished setup.
const realBootstrap = await vi.importActual<
  typeof import('@/lib/server/domains/principals/bootstrap-admin')
>('@/lib/server/domains/principals/bootstrap-admin')
vi.mock('@/lib/server/domains/principals/bootstrap-admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/principals/bootstrap-admin')>()),
  isSetupOpenToClaim: hoisted.isSetupOpenToClaim,
}))

import { getWorkspaceClaimFn, saveWorkspaceAndGoalFn } from '../onboarding'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .limit(0)
    await db.select({ id: user.id }).from(user).limit(0)
    await db.select({ id: settings.id, setupState: settings.setupState }).from(settings).limit(0)
  },
})

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

/** Accounts are created one after another, a second apart. */
let clock = Date.parse('2026-10-01T09:00:00.000Z')

/** An account as sign-up leaves it: a principal at the default role. */
async function seedAccount(email: string, type: 'user' | 'anonymous' = 'user'): Promise<UserId> {
  const userId = await seedUser(email)
  clock += 1000
  await testDb.insert(principal).values({
    id: createId('principal') as PrincipalId,
    userId,
    role: 'user',
    type,
    createdAt: new Date(clock),
  })
  return userId
}

/** The widget's visitor: an anonymous principal behind a placeholder address. */
function seedVisitor(): Promise<UserId> {
  return seedAccount(`temp-${createId('user')}@${ANON_EMAIL_DOMAIN}`, 'anonymous')
}

async function seedSettings(setupState: string): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Existing',
    slug: `existing-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    setupState,
  })
}

/** What a control plane writes on a workspace it created. */
async function seedProvisionedWorkspace(): Promise<void> {
  await seedSettings(JSON.stringify(mergeSetupState(null, { name: 'Acme' })))
  await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = 'ws_acme'`)
}

const NOT_OWNER = { ok: false, refusal: 'not_owner' }

function signIn(userId: UserId | null): void {
  hoisted.getSession.mockResolvedValue(
    userId ? { session: { scope: 'dashboard' }, user: { id: userId } } : null
  )
}

async function roleOf(userId: UserId): Promise<string | undefined> {
  const row = await testDb.query.principal.findFirst({ where: eq(principal.userId, userId) })
  return row?.role
}

async function workspace() {
  const [row] = await testDb.select().from(settings)
  return row ? { name: row.name, useCase: getSetupState(row.setupState)?.useCase } : undefined
}

describe.skipIf(!fixture.available)('the workspace step', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
    hoisted.isSetupOpenToClaim.mockImplementation(realBootstrap.isSetupOpenToClaim)
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('once setup is finished', () => {
    // Two tabs of the same admin. The first finishes setup; the second was
    // opened on the workspace step before that and is submitted afterwards.
    it('refuses a second save, even from the admin who finished it', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)

      const first = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Fernhill', useCase: 'customer_support' },
      })
      expect(first).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(ownerId)).toBe('admin')

      const second = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Second Tab Co', useCase: 'product_feedback' },
      })

      expect(second).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await workspace()).toEqual({ name: 'Fernhill', useCase: 'customer_support' })
    })

    // The early check runs outside any lock, so a save can pass it while
    // another tab is still finishing. The write itself has to refuse.
    it('refuses a save that passed the early check before the other tab finished', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)
      await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Fernhill', useCase: 'customer_support' },
      })
      hoisted.isSetupOpenToClaim.mockResolvedValueOnce(true)

      const late = await saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Second Tab Co', useCase: 'product_feedback' },
      })

      expect(late).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await workspace()).toEqual({ name: 'Fernhill', useCase: 'customer_support' })
    })

    // Same race on a fresh install, where the first save creates the settings
    // row rather than updating it.
    it('refuses a late save that would create a second settings row', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)
      await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })
      hoisted.isSetupOpenToClaim.mockResolvedValueOnce(true)
      // The late tab read "no settings yet" before the first one wrote them.
      const staleRead = vi
        .spyOn(testDb.query.settings, 'findFirst')
        .mockResolvedValueOnce(undefined as never)

      const late = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Second Tab Co' } })

      staleRead.mockRestore()
      expect(late).toEqual({ ok: false, refusal: 'setup_complete' })
      expect(await testDb.select({ name: settings.name }).from(settings)).toEqual([
        { name: 'Fernhill' },
      ])
    })
  })

  describe('on an install still being set up', () => {
    // The window this closes: the first person created their account and has
    // not reached "Open workspace" yet. Before, the workspace step went to
    // whoever submitted it first.
    it('belongs to the first account created, and refuses the second', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      const secondId = await seedAccount('second@elsewhere.example')

      signIn(secondId)
      const taken = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Hijacked' } })
      signIn(ownerId)
      const owned = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(taken).toEqual(NOT_OWNER)
      expect(owned).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(secondId)).toBe('user')
      expect(await roleOf(ownerId)).toBe('admin')
    })

    // Signed out after creating the account, by the wizard's own Sign out or
    // a lost cookie. The claim is the account's, not the session's.
    it('still belongs to the claimant after they sign out and back in', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      await seedAccount('second@elsewhere.example')

      signIn(null)
      const signedOut = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })
      signIn(ownerId)
      const back = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(signedOut).toEqual({ ok: false, refusal: 'signed_out' })
      expect(back).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(ownerId)).toBe('admin')
    })

    // The widget can mint an anonymous visitor before anyone signs up. A
    // visitor is not an account, so it neither claims setup nor holds it.
    it('is not claimed by an anonymous visitor who arrived first', async () => {
      const visitorId = await seedVisitor()
      const ownerId = await seedAccount('owner@acme.example')

      signIn(visitorId)
      const visitor = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Visitor Co' } })
      signIn(ownerId)
      const owner = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(visitor).toEqual(NOT_OWNER)
      expect(owner).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(visitorId)).toBe('user')
    })

    it('reads as claimed once an account exists, without saying whose', async () => {
      await seedVisitor()
      await expect(getWorkspaceClaimFn()).resolves.toMatchObject({ claimed: false })

      await seedAccount('jane.doe@acme.example')
      const claim = await getWorkspaceClaimFn()

      expect(claim).toEqual({
        claimed: true,
        setupComplete: false,
        openToClaim: true,
        closedReason: null,
      })
      expect(JSON.stringify(claim)).not.toMatch(/jane|acme/)
    })
  })

  // The way out of a stranded install: the first account belongs to a test,
  // a stray visitor or a script, or its password is lost with no mail to reset
  // it. Only someone who controls the server's environment can name an owner.
  describe('when the operator names the setup owner', () => {
    beforeEach(() => {
      process.env.SETUP_OWNER_EMAIL = ' Owner@Acme.Example '
    })
    afterEach(() => {
      delete process.env.SETUP_OWNER_EMAIL
    })

    it('belongs to the named account, not the first one created', async () => {
      const strayId = await seedAccount('smoke-test@elsewhere.example')
      const ownerId = await seedAccount('owner@acme.example')

      signIn(strayId)
      const stray = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Smoke Test' } })
      signIn(ownerId)
      const owned = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(stray).toEqual(NOT_OWNER)
      expect(owned).toMatchObject({ ok: true, name: 'Fernhill' })
      expect(await roleOf(strayId)).toBe('user')
      expect(await roleOf(ownerId)).toBe('admin')
    })

    // Until the named owner has an account, nobody else holds setup, and the
    // first screen offers account creation again so the owner can make one.
    it('is held for the named address before it has an account', async () => {
      const strayId = await seedAccount('smoke-test@elsewhere.example')

      signIn(strayId)
      const stray = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Smoke Test' } })

      expect(stray).toEqual(NOT_OWNER)
      expect(await roleOf(strayId)).toBe('user')
      expect(await workspace()).toBeUndefined()
      await expect(getWorkspaceClaimFn()).resolves.toEqual({
        claimed: false,
        setupComplete: false,
        openToClaim: true,
        closedReason: null,
      })
    })

    it('reads as claimed once the named address has an account, without saying whose', async () => {
      await seedAccount('smoke-test@elsewhere.example')
      await seedAccount('owner@acme.example')

      const claim = await getWorkspaceClaimFn()

      expect(claim).toMatchObject({ claimed: true, openToClaim: true })
      expect(JSON.stringify(claim)).not.toMatch(/owner|acme/)
    })

    // The variable is read on every workspace a process serves. It must not
    // open one a control plane created for a customer.
    it('opens no provisioned workspace', async () => {
      await seedProvisionedWorkspace()
      const arrivalId = await seedAccount('owner@acme.example')

      signIn(arrivalId)
      const result = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Taken' } })

      expect(result).toEqual(NOT_OWNER)
      expect(await roleOf(arrivalId)).toBe('user')
      await expect(getWorkspaceClaimFn()).resolves.toMatchObject({
        claimed: false,
        openToClaim: false,
      })
    })
  })

  describe('where the first account does not claim setup', () => {
    // The config file can stamp setup complete before its owner arrives. Its
    // portal is live, so its first sign-up is a customer, not the owner: the
    // workspace step still goes to whoever reaches it first, as before.
    it('lets a later account claim a workspace the config file stamped complete', async () => {
      await seedSettings(
        JSON.stringify(mergeSetupState(null, { name: 'Acme', onboardingComplete: true }))
      )
      await seedAccount('customer@elsewhere.example')
      const ownerId = await seedAccount('owner@acme.example')

      await expect(getWorkspaceClaimFn()).resolves.toMatchObject({ claimed: false })
      signIn(ownerId)
      const owned = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme' } })

      expect(owned).toMatchObject({ ok: true })
      expect(await roleOf(ownerId)).toBe('admin')
    })

    // Its owner is recorded where it was created; an account here claims
    // nothing, and the screen keeps saying so.
    it('leaves a provisioned workspace closed to every arrival', async () => {
      await seedProvisionedWorkspace()
      const arrivalId = await seedAccount('first@evil.example')

      signIn(arrivalId)
      const result = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Taken' } })

      expect(result).toEqual(NOT_OWNER)
      expect(await roleOf(arrivalId)).toBe('user')
      await expect(getWorkspaceClaimFn()).resolves.toMatchObject({
        claimed: false,
        openToClaim: false,
        closedReason: 'provisioned',
      })
    })

    it('leaves a finished workspace with accounts on it reading unclaimed and closed', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)
      await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })
      await testDb.update(principal).set({ role: 'user' }).where(eq(principal.userId, ownerId))
      await seedAccount('customer@elsewhere.example')

      await expect(getWorkspaceClaimFn()).resolves.toEqual({
        claimed: false,
        setupComplete: true,
        openToClaim: false,
        closedReason: 'setupComplete',
      })
    })
  })

  // A name that romanizes to nothing ("🦆🦆", "!!") is still a name of two
  // characters. It used to fail with a developer error about slugs.
  it('accepts a name with nothing in it to put in a URL', async () => {
    const ownerId = await seedAccount('owner@acme.example')
    signIn(ownerId)

    const result = await saveWorkspaceAndGoalFn({ data: { workspaceName: '🦆🦆' } })

    expect(result).toMatchObject({ ok: true, name: '🦆🦆', slug: 'workspace' })
  })

  // The form trims before it checks, but a direct call does not go through
  // the form. A name of spaces would leave the workspace with no name at all.
  describe('a name that is blank once trimmed', () => {
    it.each(['  ', ' a '])('refuses workspace name %j, and nothing is written', async (name) => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)

      await expect(saveWorkspaceAndGoalFn({ data: { workspaceName: name } })).rejects.toThrow(
        /at least 2 characters/
      )

      expect(await workspace()).toBeUndefined()
      expect(await roleOf(ownerId)).toBe('user')
    })

    it('refuses a user name of spaces', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)

      await expect(
        saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill', userName: '   ' } })
      ).rejects.toThrow(/at least 2 characters/)

      expect(await workspace()).toBeUndefined()
    })

    it('saves a padded name without its padding', async () => {
      const ownerId = await seedAccount('owner@acme.example')
      signIn(ownerId)

      const result = await saveWorkspaceAndGoalFn({
        data: { workspaceName: '  Fernhill  ', userName: '  Sam Rivers ' },
      })

      expect(result).toMatchObject({ ok: true, name: 'Fernhill', slug: 'fernhill' })
      const [row] = await testDb.select({ name: user.name }).from(user).where(eq(user.id, ownerId))
      expect(row?.name).toBe('Sam Rivers')
    })
  })

  describe('a lost session', () => {
    it('is refused as signed out, and nothing is written', async () => {
      await seedAccount('owner@acme.example')
      signIn(null)

      const result = await saveWorkspaceAndGoalFn({ data: { workspaceName: 'Fernhill' } })

      expect(result).toEqual({ ok: false, refusal: 'signed_out' })
      expect(await workspace()).toBeUndefined()
    })
  })
})
