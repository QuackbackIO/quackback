/**
 * Real-Postgres coverage for the add-people flow: who the picker offers
 * (findPeopleToAdd) and the batch add (addTeamMembers), which validates the
 * whole request before writing and either applies all of it or none.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  account,
  auditLog,
  eq,
  identityProvider,
  invitation,
  principal,
  roles,
  session,
  settings,
  user,
} from '@/lib/server/db'
import { ALL_PERMISSIONS, PERMISSIONS } from '@/lib/shared/permissions'
import { countSeatUsage } from '../seat-usage'

const hoisted = vi.hoisted(() => ({
  mint: vi.fn(),
  sendInvitationEmail: vi.fn(),
  revokeMagicLinkTokens: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

vi.mock('@/lib/server/cache', () => ({
  cacheDel: vi.fn(),
  CACHE_KEYS: { PRINCIPAL_BY_USER: (id: string) => `principal:user:${id}` },
}))

vi.mock('@/lib/server/domains/teams', () => ({
  addPrincipalToDefaultTeam: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/membership-sync', () => ({
  enqueueMembershipSync: vi.fn(async () => {}),
}))

// Minting writes Better Auth verification rows; the double echoes the address
// it was asked for so the sealed recipient and token set can be checked.
vi.mock('@/lib/server/functions/invitation-magic-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/invitation-magic-link')>()),
  generateInvitationMagicLink: (email: string, callbackPath: string) =>
    hoisted.mint(email, callbackPath),
}))

vi.mock('@quackback/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/email')>()),
  sendInvitationEmail: (...args: unknown[]) => hoisted.sendInvitationEmail(...args),
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  revokeMagicLinkTokens: (...args: unknown[]) => hoisted.revokeMagicLinkTokens(...args),
}))

const { addTeamMembers } = await import('../team-additions')
const { findPeopleToAdd } = await import('../people-to-add')
const { invalidateTierLimitsCache } =
  await import('@/lib/server/domains/settings/tier-limits.service')

// Statements sent on the fixture connection, recorded while `recording` is on.
let recording = false
const statements: string[] = []

const fixture = await createDbTestFixture({
  logger: {
    logQuery: (query: string) => {
      if (recording) statements.push(query)
    },
  },
  probe: async (db) => {
    await db.select({ id: principal.id, type: principal.type }).from(principal).limit(0)
    await db.select({ id: account.id }).from(account).limit(0)
    await db.select({ id: session.id, scope: session.scope }).from(session).limit(0)
    await db.select({ id: identityProvider.id }).from(identityProvider).limit(0)
    await db.select({ id: invitation.id, kind: invitation.kind }).from(invitation).limit(0)
    await db.select({ id: settings.id, tierLimits: settings.tierLimits }).from(settings).limit(0)
  },
})

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

type Person = { userId: UserId; principalId: PrincipalId; name: string; email: string | null }

async function seedPerson(opts: {
  name?: string
  email?: string | null
  role?: 'admin' | 'member' | 'user'
  type?: 'user' | 'anonymous' | 'support'
  account?: { providerId: string; accountId: string }
  session?: { scope: 'portal' | 'widget' | 'dashboard'; updatedAt?: Date }
}): Promise<Person> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  const name = opts.name ?? `Person ${tag()}`
  const email = opts.email === undefined ? `p-${tag()}@example.com` : opts.email
  await testDb.insert(user).values({ id: userId, name, email })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: opts.role ?? 'user',
    type: opts.type ?? 'user',
    createdAt: new Date(),
  })
  if (opts.account) {
    await testDb.insert(account).values({ ...opts.account, userId, updatedAt: new Date() })
  }
  if (opts.session) {
    await testDb.insert(session).values({
      id: `sess-${tag()}`,
      token: `tok-${tag()}`,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: opts.session.updatedAt ?? new Date(),
      scope: opts.session.scope,
    })
  }
  return { userId, principalId, name, email }
}

const signedIn = { session: { scope: 'portal' as const } }

async function setFreeSeats(free: number) {
  const { used } = await countSeatUsage(testDb)
  const tierLimits = JSON.stringify({ maxTeamSeats: used + free })
  const existing = await testDb.select({ id: settings.id }).from(settings)
  if (existing.length === 0) {
    await testDb.insert(settings).values({
      id: createId('workspace'),
      name: 'Acme',
      slug: `acme-${tag()}`,
      createdAt: new Date(),
      tierLimits,
    })
  } else {
    await testDb.update(settings).set({ tierLimits }).where(eq(settings.id, existing[0].id))
  }
  invalidateTierLimitsCache()
}

async function roleOf(principalId: PrincipalId) {
  const [row] = await testDb.select().from(principal).where(eq(principal.id, principalId))
  return row.role
}

async function pendingInvites() {
  return testDb.select().from(invitation).where(eq(invitation.status, 'pending'))
}

function granterFor(p: Person, role: 'admin' | 'member') {
  return {
    principalId: p.principalId,
    userId: p.userId,
    name: 'Granter',
    role,
    permissions: ALL_PERMISSIONS,
  }
}

const ctx = {
  workspace: { name: 'Acme', logoKey: null },
  actor: { email: 'granter@example.com', role: 'admin', type: 'user' as const },
}

if (fixture.available) {
  beforeEach(async () => {
    vi.clearAllMocks()
    hoisted.mint.mockImplementation(async (email: string, callbackPath: string) => ({
      url: `https://acme.test${callbackPath}`,
      token: `token-for-${email}`,
      sealedAddress: email,
    }))
    hoisted.sendInvitationEmail.mockResolvedValue({ sent: true })
    await fixture.begin()
    await setFreeSeats(100)
  })
  afterEach(() => {
    invalidateTierLimitsCache()
    return fixture.rollback()
  })
  afterAll(() => fixture.close())
}

describe.skipIf(!fixture.available)('findPeopleToAdd', () => {
  it('empty query: up to five recently active portal users who signed in, newest first', async () => {
    const caller = await seedPerson({ role: 'admin', ...signedIn })
    const people: Person[] = []
    for (let i = 0; i < 6; i++) {
      people.push(
        await seedPerson({
          session: { scope: 'portal', updatedAt: new Date(Date.now() - (6 - i) * 60_000) },
        })
      )
    }
    await seedPerson({}) // contact that never signed in
    await seedPerson({ session: { scope: 'widget' } }) // widget-only identity
    await seedPerson({ type: 'anonymous', ...signedIn })
    await seedPerson({ role: 'member', ...signedIn }) // teammate, not offered when idle
    await seedPerson({ role: 'admin', type: 'support', ...signedIn })

    const result = await findPeopleToAdd({
      query: '',
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })

    expect(result.canSearchPeople).toBe(true)
    expect(result.email).toBeUndefined()
    expect(result.people.map((p) => p.principalId)).toEqual(
      people
        .slice(1)
        .reverse()
        .map((p) => p.principalId)
    )
    expect(result.people.every((p) => p.status === 'portal_user')).toBe(true)
  })

  it('matches name, real email and provider account id; teammates come back with their status', async () => {
    const t = tag()
    const caller = await seedPerson({ role: 'admin', name: `Zed ${t}`, ...signedIn })
    const byName = await seedPerson({ name: `Ada ${t}`, ...signedIn })
    const byEmail = await seedPerson({ email: `grace-${t}@example.com`, ...signedIn })
    const teammate = await seedPerson({ role: 'member', name: `Mia ${t}` })
    await testDb.insert(identityProvider).values({
      registrationId: `community-${t}`,
      label: 'Community Login',
      clientId: 'client',
    })
    const ssoOnly = await seedPerson({
      name: 'Steam Person',
      email: `sso-steam-${t}@anon.quackback.io`,
      account: { providerId: `community-${t}`, accountId: `7656119${t}` },
    })
    const neverSignedIn = await seedPerson({ name: `Ada contact ${t}` })

    const byNameResult = await findPeopleToAdd({
      query: t.toUpperCase(),
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })
    const ids = byNameResult.people.map((p) => p.principalId)
    expect(ids).toContain(byName.principalId)
    expect(ids).toContain(byEmail.principalId)
    expect(ids).toContain(ssoOnly.principalId) // via the provider account id
    expect(ids).toContain(teammate.principalId)
    expect(ids).not.toContain(caller.principalId)
    expect(ids).not.toContain(neverSignedIn.principalId)
    expect(byNameResult.people.find((p) => p.principalId === teammate.principalId)?.status).toBe(
      'member'
    )
    expect(byNameResult.people.find((p) => p.principalId === byEmail.principalId)?.detail).toBe(
      `grace-${t}@example.com`
    )
    const sso = byNameResult.people.find((p) => p.principalId === ssoOnly.principalId)
    expect(sso?.detail).toBe(`Signs in with Community Login · 7656119${t}`)
    expect(JSON.stringify(byNameResult)).not.toContain('anon.quackback.io')
  })

  it('never matches on a placeholder address', async () => {
    const caller = await seedPerson({ role: 'admin', ...signedIn })
    await seedPerson({
      email: `sso-steam-${tag()}@anon.quackback.io`,
      account: { providerId: 'github', accountId: '42' },
    })

    const result = await findPeopleToAdd({
      query: 'anon.quackback',
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })
    expect(result.people).toEqual([])
  })

  it('treats LIKE wildcards in the query literally', async () => {
    const caller = await seedPerson({ role: 'admin', ...signedIn })
    await seedPerson({ name: 'Plain Name', ...signedIn })

    const result = await findPeopleToAdd({
      query: '%',
      callerPrincipalId: caller.principalId,
      canSearchPeople: true,
    })
    expect(result.people).toEqual([])
  })

  it('a full email address reports where it stands', async () => {
    const caller = await seedPerson({ role: 'admin', ...signedIn })
    const portal = await seedPerson({ ...signedIn })
    const contact = await seedPerson({})
    const teammate = await seedPerson({ role: 'member' })
    const invitedAt = new Date('2026-01-02T03:04:05Z')
    const inviteId = createId('invite')
    await testDb.insert(invitation).values({
      id: inviteId,
      email: 'pending@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: caller.userId,
      createdAt: invitedAt,
    })
    const lookup = (query: string, canSearchPeople = true) =>
      findPeopleToAdd({ query, callerPrincipalId: caller.principalId, canSearchPeople }).then(
        (r) => r.email
      )

    expect(await lookup('Someone.New@Example.com')).toEqual({
      address: 'someone.new@example.com',
      status: 'new',
    })
    expect(await lookup('pending@example.com')).toEqual({
      address: 'pending@example.com',
      status: 'pending_invite',
      invitationId: inviteId,
      invitedAt: invitedAt.toISOString(),
      roleName: 'Member',
    })
    const customRoleId = createId('role')
    await testDb
      .insert(roles)
      .values({ id: customRoleId, key: customRoleId, name: 'Support lead', isSystem: false })
    await testDb.insert(invitation).values([
      {
        id: createId('invite'),
        email: 'pending-admin@example.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: caller.userId,
        createdAt: invitedAt,
      },
      {
        id: createId('invite'),
        email: 'pending-custom@example.com',
        role: 'member',
        roleId: customRoleId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: caller.userId,
        createdAt: invitedAt,
      },
    ])
    expect(await lookup('pending-admin@example.com')).toMatchObject({ roleName: 'Admin' })
    expect(await lookup('pending-custom@example.com')).toMatchObject({ roleName: 'Support lead' })
    expect(await lookup(teammate.email!)).toMatchObject({
      status: 'member',
      principalId: teammate.principalId,
    })
    expect(await lookup(portal.email!.toUpperCase())).toEqual({
      address: portal.email,
      status: 'portal_user',
      principalId: portal.principalId,
    })
    // A contact who never signed in is invited by email instead.
    expect(await lookup(contact.email!)).toEqual({ address: contact.email, status: 'new' })
    expect(await lookup('sso-x@anon.quackback.io')).toBeUndefined()
    expect(await lookup('not an email')).toBeUndefined()
  })

  it('without people.view: no people, and an email never reveals a portal user', async () => {
    const caller = await seedPerson({ role: 'member', ...signedIn })
    const portal = await seedPerson({ ...signedIn })

    const result = await findPeopleToAdd({
      query: portal.email!,
      callerPrincipalId: caller.principalId,
      canSearchPeople: false,
    })
    expect(result).toEqual({
      canSearchPeople: false,
      people: [],
      email: { address: portal.email, status: 'new' },
    })
    const idle = await findPeopleToAdd({
      query: '',
      callerPrincipalId: caller.principalId,
      canSearchPeople: false,
    })
    expect(idle.people).toEqual([])
  })
})

describe.skipIf(!fixture.available)('addTeamMembers', () => {
  it('adds signed-in portal users at once and invites emails, in one batch', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const a = await seedPerson({ account: { providerId: 'github', accountId: '1' } })
    const b = await seedPerson({ ...signedIn })
    await setFreeSeats(3)

    const result = await addTeamMembers(
      {
        principalIds: [a.principalId, b.principalId],
        emails: ['New.Person@Example.com'],
        role: 'member',
      },
      granterFor(admin, 'admin'),
      ctx
    )

    expect(result.added).toEqual([
      { principalId: a.principalId, name: a.name },
      { principalId: b.principalId, name: b.name },
    ])
    expect(result.invited).toHaveLength(1)
    expect(result.invited[0]).toMatchObject({ email: 'new.person@example.com', emailSent: true })
    expect(await roleOf(a.principalId)).toBe('member')
    expect(await roleOf(b.principalId)).toBe('member')

    const invites = await pendingInvites()
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({
      id: result.invited[0].invitationId,
      email: 'new.person@example.com',
      role: 'member',
      inviterId: admin.userId,
      magicLinkTokens: ['token-for-new.person@example.com'],
    })
    expect(hoisted.sendInvitationEmail).toHaveBeenCalledOnce()
    expect(hoisted.sendInvitationEmail.mock.calls[0][0]).toMatchObject({
      to: 'new.person@example.com',
      workspaceName: 'Acme',
    })

    const audits = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'user.role.changed'))
    expect(audits.map((r) => r.targetId).sort()).toEqual([a.principalId, b.principalId].sort())
    expect(audits[0].afterValue).toEqual({ role: 'member' })
  })

  it('refuses a batch that needs more seats than are free, writing nothing', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const a = await seedPerson({ ...signedIn })
    const b = await seedPerson({ ...signedIn })
    await setFreeSeats(2)

    await expect(
      addTeamMembers(
        { principalIds: [a.principalId, b.principalId], emails: ['x@example.com'], role: 'member' },
        granterFor(admin, 'admin'),
        ctx
      )
    ).rejects.toMatchObject({
      code: 'SEAT_LIMIT',
      needed: 3,
      free: 2,
      message: expect.stringMatching(/needs 3 and 2 are free/),
    })
    expect(await roleOf(a.principalId)).toBe('user')
    expect(await roleOf(b.principalId)).toBe('user')
    expect(await pendingInvites()).toEqual([])
    expect(hoisted.mint).not.toHaveBeenCalled()
  })

  it('validates every item before writing any: one bad email stops the whole batch', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const a = await seedPerson({ ...signedIn })
    const teammate = await seedPerson({ role: 'member' })

    await expect(
      addTeamMembers(
        { principalIds: [a.principalId], emails: [teammate.email!], role: 'member' },
        granterFor(admin, 'admin'),
        ctx
      )
    ).rejects.toMatchObject({ code: 'ALREADY_MEMBER', email: teammate.email })
    expect(await roleOf(a.principalId)).toBe('user')
    expect(await pendingInvites()).toEqual([])
  })

  it('refuses a pending invite, a teammate, and people who cannot join', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const teammate = await seedPerson({ role: 'member', ...signedIn })
    const contact = await seedPerson({})
    const widgetOnly = await seedPerson({ session: { scope: 'widget' } })
    const anon = await seedPerson({ type: 'anonymous', ...signedIn })
    await testDb.insert(invitation).values({
      id: createId('invite'),
      email: 'pending@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: admin.userId,
      createdAt: new Date(),
    })
    const add = (principalIds: string[], emails: string[] = []) =>
      addTeamMembers({ principalIds, emails, role: 'member' }, granterFor(admin, 'admin'), ctx)

    await expect(add([], ['Pending@example.com'])).rejects.toMatchObject({
      code: 'INVITE_PENDING',
      email: 'pending@example.com',
    })
    await expect(add([teammate.principalId])).rejects.toMatchObject({
      code: 'ALREADY_MEMBER',
      principalId: teammate.principalId,
    })
    await expect(add([admin.principalId])).rejects.toMatchObject({ code: 'ALREADY_MEMBER' })
    for (const p of [contact, widgetOnly, anon]) {
      await expect(add([p.principalId])).rejects.toMatchObject({
        code: 'NOT_ELIGIBLE',
        principalId: p.principalId,
      })
    }
    await expect(add([createId('principal')])).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' })
    await expect(add([], ['sso-x@anon.quackback.io'])).rejects.toMatchObject({
      code: 'NOT_ELIGIBLE',
      email: 'sso-x@anon.quackback.io',
    })
    expect(await roleOf(contact.principalId)).toBe('user')
  })

  it('only an admin grants Admin, to people and invites alike', async () => {
    const manager = await seedPerson({ role: 'member', ...signedIn })
    const a = await seedPerson({ ...signedIn })

    await expect(
      addTeamMembers(
        { principalIds: [a.principalId], emails: [], role: 'admin' },
        granterFor(manager, 'member'),
        ctx
      )
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    await expect(
      addTeamMembers(
        { principalIds: [], emails: ['x@example.com'], role: 'admin' },
        granterFor(manager, 'member'),
        ctx
      )
    ).rejects.toMatchObject({ code: 'GRANT_CEILING' })
    expect(await roleOf(a.principalId)).toBe('user')

    const ok = await addTeamMembers(
      { principalIds: [a.principalId], emails: [], role: 'member' },
      { ...granterFor(manager, 'member'), permissions: [PERMISSIONS.MEMBER_MANAGE] },
      ctx
    )
    expect(ok.added).toHaveLength(1)
  })

  it('refuses duplicates, an empty request and more than 50 items', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const a = await seedPerson({ ...signedIn })
    const add = (principalIds: string[], emails: string[]) =>
      addTeamMembers({ principalIds, emails, role: 'member' }, granterFor(admin, 'admin'), ctx)

    await expect(add([a.principalId, a.principalId], [])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(add([], ['x@example.com', 'X@example.com'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(add([a.principalId], [a.email!])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(add([], [])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const many = Array.from({ length: 51 }, (_, i) => `p${i}@example.com`)
    await expect(add([], many)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await roleOf(a.principalId)).toBe('user')
  })

  it('keeps the batch when an invitation email fails, returning the link to share', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    hoisted.sendInvitationEmail.mockRejectedValueOnce(new Error('smtp down'))

    const result = await addTeamMembers(
      { principalIds: [], emails: ['x@example.com'], role: 'member' },
      granterFor(admin, 'admin'),
      ctx
    )
    expect(result.invited[0]).toMatchObject({ emailSent: false })
    expect(result.invited[0].inviteLink).toContain(result.invited[0].invitationId)
    expect(await pendingInvites()).toHaveLength(1)
  })
})

describe.skipIf(!fixture.available)('addTeamMembers: invites, races and volume', () => {
  it('offers and adds someone whose only sign-in record is an email sign-in', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const t = tag()
    const emailOnly = await seedPerson({ name: `Email ${t}` })
    await testDb.insert(auditLog).values({
      eventType: 'auth.signin.success',
      actorUserId: emailOnly.userId,
      metadata: { method: 'magic-link' },
    })

    const found = await findPeopleToAdd({
      query: t,
      callerPrincipalId: admin.principalId,
      canSearchPeople: true,
    })
    expect(found.people.map((p) => p.principalId)).toEqual([emailOnly.principalId])

    const result = await addTeamMembers(
      { principalIds: [emailOnly.principalId], emails: [], role: 'member' },
      granterFor(admin, 'admin'),
      ctx
    )
    expect(result.added).toHaveLength(1)
  })

  it("retires a person's pending team invite when adding them directly, reusing its seat", async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const a = await seedPerson({ ...signedIn })
    const inviteId = createId('invite')
    await testDb.insert(invitation).values({
      id: inviteId,
      email: a.email!.toUpperCase(),
      role: 'admin',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: admin.userId,
      createdAt: new Date(),
      magicLinkTokens: ['old-invite-token'],
    })
    await setFreeSeats(1) // a's invite holds one seat; the new email needs the free one

    await addTeamMembers(
      { principalIds: [a.principalId], emails: ['new@example.com'], role: 'member' },
      granterFor(admin, 'admin'),
      ctx
    )

    expect(await roleOf(a.principalId)).toBe('member')
    const [old] = await testDb.select().from(invitation).where(eq(invitation.id, inviteId))
    expect(old.status).toBe('canceled')
    expect(hoisted.revokeMagicLinkTokens).toHaveBeenCalledWith(['old-invite-token'])
    expect((await pendingInvites()).map((i) => i.email)).toEqual(['new@example.com'])
  })

  it('re-checks pending invites under the lock: a racing invite for the same email wins', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    // The racing request lands after validation, while links are being minted.
    hoisted.mint.mockImplementation(async (email: string, callbackPath: string) => {
      await testDb.insert(invitation).values({
        id: createId('invite'),
        email,
        role: 'member',
        status: 'pending',
        expiresAt: new Date(Date.now() + 86_400_000),
        inviterId: admin.userId,
        createdAt: new Date(),
      })
      return { url: `https://acme.test${callbackPath}`, token: `t-${email}`, sealedAddress: email }
    })

    await expect(
      addTeamMembers(
        { principalIds: [], emails: ['race@example.com'], role: 'member' },
        granterFor(admin, 'admin'),
        ctx
      )
    ).rejects.toMatchObject({ code: 'INVITE_PENDING', email: 'race@example.com' })
    expect(await pendingInvites()).toHaveLength(1)
    expect(hoisted.revokeMagicLinkTokens).toHaveBeenCalledWith(['t-race@example.com'])
  })

  it('classifies a batch of emails in bulk, not per address', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    const emails = Array.from({ length: 10 }, (_, i) => `bulk${i}@example.com`)

    statements.length = 0
    recording = true
    try {
      await addTeamMembers(
        { principalIds: [], emails, role: 'member' },
        granterFor(admin, 'admin'),
        ctx
      )
    } finally {
      recording = false
    }
    // Per-address lookups (the seat counts also read the table, without an email filter).
    const invitationReads = statements.filter(
      (q) => /^select/i.test(q.trim()) && /from "invitation"/i.test(q) && /"email"/.test(q)
    )
    // One read before the lock and one re-check under it.
    expect(invitationReads.length).toBeLessThanOrEqual(2)
    expect(await pendingInvites()).toHaveLength(10)
  })

  it('sends invitation emails a few at a time after commit', async () => {
    const admin = await seedPerson({ role: 'admin', ...signedIn })
    let inFlight = 0
    let peak = 0
    hoisted.sendInvitationEmail.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return { sent: true }
    })
    const emails = Array.from({ length: 12 }, (_, i) => `send${i}@example.com`)

    const result = await addTeamMembers(
      { principalIds: [], emails, role: 'member' },
      granterFor(admin, 'admin'),
      ctx
    )
    expect(result.invited.every((i) => i.emailSent)).toBe(true)
    expect(hoisted.sendInvitationEmail).toHaveBeenCalledTimes(12)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
  })
})
