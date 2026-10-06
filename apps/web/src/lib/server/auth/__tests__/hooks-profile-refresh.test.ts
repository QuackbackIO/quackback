/**
 * `handleProfileRefreshAfter`: keep an account's name and avatar in step with
 * its identity provider after an OIDC callback, without ever overwriting what a
 * person chose in Quackback.
 *
 *  - An empty avatar is filled from the provider's avatar, for every provider.
 *    Better-Auth writes `image` only when it CREATES the user, and
 *    `overrideUserInfo` stays off.
 *  - With profile sync on, a name or avatar the provider set (or a name
 *    generated at sign-up) follows the provider's current value. A name a
 *    person typed and an uploaded avatar never do.
 *  - `account_profile_sync` records what the provider last wrote, which is
 *    how "the provider set this" is told apart from "a person chose this".
 *    It is a table Better-Auth never reads; a database without it yet still
 *    gets the avatar fill.
 *
 * The name, avatar and generated names are the resolver's decisions for this
 * sign-in, handed over through the resolved-claims stash. The hook never
 * re-reads claims, so a stale read (no stash) changes nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUserFindFirst = vi.fn()
const mockAccountFindFirst = vi.fn()
const mockRecordFindFirst = vi.fn()
type Write = {
  table: unknown
  op: 'update' | 'upsert' | 'delete'
  values?: Record<string, unknown>
  conflict?: { target: unknown; set: Record<string, unknown> }
  where?: unknown
  via?: 'db' | 'tx'
}
const writes: Write[] = []
/** Rows the user update returns: the compare-and-swap matched, by default. */
const mockReturning = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [{ id: 'user_abc' }])
function updater(via: 'db' | 'tx') {
  return vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (where: unknown) => {
        writes.push({ table, op: 'update', values, where, via })
        return { returning: mockReturning }
      },
    }),
  }))
}
const tx = { update: updater('tx') }
const mockTransaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
const mockInsert = vi.fn((table: unknown) => ({
  values: (values: Record<string, unknown>) => ({
    onConflictDoUpdate: vi.fn(async (conflict: Write['conflict']) => {
      writes.push({ table, op: 'upsert', values, conflict })
    }),
  }),
}))
const mockDelete = vi.fn((table: unknown) => ({
  where: vi.fn(async (where: unknown) => {
    writes.push({ table, op: 'delete', where })
  }),
}))
const mockSyncPrincipalProfile = vi.fn(async (..._args: unknown[]) => undefined)
const mockLogInfo = vi.fn()
const mockLogError = vi.fn()
const mockLogWarn = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      user: { findFirst: mockUserFindFirst },
      account: { findFirst: mockAccountFindFirst },
      accountProfileSync: { findFirst: mockRecordFindFirst },
    },
    update: updater('db'),
    insert: mockInsert,
    delete: mockDelete,
    transaction: mockTransaction,
  },
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ op: 'isNull', col })),
  desc: vi.fn((col: unknown) => ({ op: 'desc', col })),
}))

vi.mock('@/lib/server/domains/principals/principal.factory', async (orig) => ({
  ...(await orig<typeof import('@/lib/server/domains/principals/principal.factory')>()),
  syncPrincipalProfile: (...args: unknown[]) => mockSyncPrincipalProfile(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ info: mockLogInfo, warn: mockLogWarn, error: mockLogError, debug: vi.fn() }),
  },
}))

const { handleProfileRefreshAfter } = await import('../hooks')
const { stashResolvedClaims, takeResolvedClaims } = await import('../resolved-claims-stash')
const { user: userTable, accountProfileSync: recordTable } = await import('@/lib/server/db')

const PROVIDER = 'oidc_acme'
const REGISTERED = new Set([PROVIDER])
const USER_ID = 'user_abc'
const SUBJECT = 'acct:42'
const GENERATED = 'acct 42'
// Real provider avatar URLs often carry no file extension.
const OLD_AVATAR = 'https://cdn.acme.test/123/old'
const NEW_AVATAR = 'https://cdn.acme.test/123/456'
const CHOSEN_AVATAR = 'https://elsewhere.test/me.png'

type Providers = Parameters<typeof handleProfileRefreshAfter>[2]

function providerRow(over: Record<string, unknown> = {}): Providers {
  return [{ registrationId: PROVIDER, claimMapping: null, ...over }] as unknown as Providers
}

/** A provider with "Update name and avatar on every sign-in" turned on. */
function syncing(): Providers {
  return providerRow({ claimMapping: { profile: { syncOnSignIn: true } } })
}

function ctx(over: Record<string, unknown> = {}) {
  return {
    path: '/oauth2/callback/:providerId',
    params: { providerId: PROVIDER },
    context: { newSession: { user: { id: USER_ID } } },
    ...over,
  }
}

function givenUser(over: { name?: string; image?: string | null; imageKey?: string | null }) {
  mockUserFindFirst.mockResolvedValue({ name: 'Someone', image: null, imageKey: null, ...over })
}

const ACCOUNT_ROW_ID = 'account_1'

/** The account row, plus its `account_profile_sync` record (null: no row). */
function givenAccount(
  record: { name?: string; image?: string } | null,
  over: Record<string, unknown> = {}
) {
  mockAccountFindFirst.mockResolvedValue({
    id: ACCOUNT_ROW_ID,
    accountId: SUBJECT,
    idToken: null,
    ...over,
  })
  mockRecordFindFirst.mockResolvedValue(
    record ? { name: record.name ?? null, image: record.image ?? null } : undefined
  )
}

/** What the resolver decided for this sign-in, stashed the way sign-in does. */
function givenSignIn(
  profile: { name?: string; image?: string; generatedNames?: string[] },
  claims: Record<string, unknown> = {}
) {
  stashResolvedClaims(PROVIDER, SUBJECT, {
    claims,
    profile: { generatedNames: [GENERATED], ...profile },
  })
}

const userWrites = () =>
  writes.filter((w) => w.table === userTable && w.op === 'update').map((w) => w.values)

/** Record writes as `{ record }`: the recorded fields of an upsert, or null for a delete. */
const recordWrites = () =>
  writes
    .filter((w) => w.table === recordTable)
    .map((w) => {
      if (w.op === 'delete') return { record: null }
      const { name, image } = w.values ?? {}
      return {
        record: {
          ...(name !== null ? { name } : {}),
          ...(image !== null ? { image } : {}),
        },
      }
    })

beforeEach(() => {
  vi.clearAllMocks()
  mockReturning.mockReset()
  mockReturning.mockImplementation(async () => [{ id: USER_ID }])
  writes.length = 0
  givenUser({})
  givenAccount(null)
  // The stash is module state; drain any entry a test left untaken.
  takeResolvedClaims(PROVIDER, SUBJECT)
})

describe('reading the sign-in', () => {
  it("takes the resolver's decisions, not the raw claims", async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR }, { picture: OLD_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
  })

  it('does nothing on a stale read, even when the stored ID token carries a profile', async () => {
    const idToken = `x.${Buffer.from(
      JSON.stringify({ sub: SUBJECT, name: 'Ada New', picture: NEW_AVATAR })
    ).toString('base64url')}.y`
    givenUser({ name: GENERATED, image: null })
    givenAccount(null, { idToken })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(writes).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
  })

  it('trusts no profile on a read that is not fresh', async () => {
    givenUser({ image: null })
    const readClaims = vi.fn(async () => ({
      claims: {},
      fresh: false,
      profile: { image: NEW_AVATAR, generatedNames: [] },
    }))

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow(), readClaims)

    expect(writes).toEqual([])
  })

  it('uses the shared per-callback reader when one is given', async () => {
    givenUser({ image: null })
    const readClaims = vi.fn(async () => ({
      claims: {},
      fresh: true,
      profile: { image: NEW_AVATAR, generatedNames: [] },
    }))

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow(), readClaims)

    expect(readClaims).toHaveBeenCalledTimes(1)
    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
  })

  it('ignores non-callback paths', async () => {
    await handleProfileRefreshAfter(ctx({ path: '/sign-in/email' }), REGISTERED, providerRow())
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('ignores an unregistered provider', async () => {
    await handleProfileRefreshAfter(ctx(), new Set<string>(), providerRow())
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })

  it('does nothing when there is no session user', async () => {
    await handleProfileRefreshAfter(
      ctx({ context: { newSession: null } }),
      REGISTERED,
      providerRow()
    )
    expect(mockUserFindFirst).not.toHaveBeenCalled()
  })
})

describe('avatar fill (every provider)', () => {
  it('fills an empty avatar from the resolved avatar', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
  })

  it('copies a filled avatar onto the principal', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(mockSyncPrincipalProfile).toHaveBeenCalledTimes(1)
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(USER_ID, { avatarUrl: NEW_AVATAR }, tx)
  })

  it('records the avatar it fills as provider-set', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(recordWrites()).toEqual([{ record: { image: NEW_AVATAR } }])
  })

  it('does nothing when the user already has an avatar and sync is off', async () => {
    givenUser({ image: CHOSEN_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
  })

  it('treats a whitespace-only image as empty', async () => {
    givenUser({ image: '   ' })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
  })

  it('does nothing when the resolver found no avatar', async () => {
    givenUser({ image: null })
    givenSignIn({})

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([])
  })
})

describe('name sync', () => {
  it('leaves a provider-set name alone while profile sync is off', async () => {
    givenUser({ name: 'Ada Old' })
    givenAccount({ name: 'Ada Old' })
    givenSignIn({ name: 'Ada New' })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
  })

  it('refreshes a name the provider wrote last time', async () => {
    givenUser({ name: 'Ada Old' })
    givenAccount({ name: 'Ada Old' })
    givenSignIn({ name: 'Ada New' })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ada New' }])
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(USER_ID, { displayName: 'Ada New' }, tx)
    expect(recordWrites()).toEqual([{ record: { name: 'Ada New' } }])
  })

  it('refreshes a name sign-up generated', async () => {
    givenUser({ name: 'ally' })
    givenSignIn({ name: 'Ally Smith', generatedNames: ['ally', GENERATED] })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ally Smith' }])
  })

  it('never overwrites a name a person typed, and stops treating it as provider-set', async () => {
    givenUser({ name: 'Ada (typed here)' })
    givenAccount({ name: 'Ada' })
    givenSignIn({ name: 'Ada New' })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
    expect(recordWrites()).toEqual([{ record: {} }])
  })

  it('never replaces a name edited after tracking began, even one that matches a generated name', async () => {
    givenUser({ name: 'ally' })
    givenAccount({ name: 'Ally Lovelace' })
    givenSignIn({ name: 'Ally Smith', generatedNames: ['ally', GENERATED] })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
    expect(recordWrites()).toEqual([{ record: {} }])
  })

  it('records a generated name as provider-set, so sync turned on later replaces it', async () => {
    givenUser({ name: GENERATED })
    givenSignIn({ name: 'Ada New' })
    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())
    expect(userWrites()).toEqual([])
    expect(recordWrites()).toEqual([{ record: { name: GENERATED } }])

    writes.length = 0
    givenAccount({ name: GENERATED })
    givenSignIn({ name: 'Ada New', generatedNames: [] })
    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ada New' }])
  })

  it('never writes a blank name, and keeps the name when the provider sent none', async () => {
    givenUser({ name: GENERATED })
    givenSignIn({ name: '   ' })
    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    takeResolvedClaims(PROVIDER, SUBJECT)
    givenSignIn({})
    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
  })
})

describe('avatar sync', () => {
  it('refreshes an avatar the provider wrote last time', async () => {
    givenUser({ image: OLD_AVATAR })
    givenAccount({ image: OLD_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(USER_ID, { avatarUrl: NEW_AVATAR }, tx)
    expect(recordWrites()).toEqual([{ record: { image: NEW_AVATAR } }])
  })

  it('never replaces an uploaded avatar', async () => {
    givenUser({ image: OLD_AVATAR, imageKey: 'avatars/user_abc.png' })
    givenAccount({ image: OLD_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
  })

  it('leaves an avatar the provider did not set, and stops treating it as provider-set', async () => {
    givenUser({ image: CHOSEN_AVATAR })
    givenAccount({ image: OLD_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
    expect(recordWrites()).toEqual([{ record: {} }])
  })

  it('leaves a provider-set avatar alone while profile sync is off', async () => {
    givenUser({ image: OLD_AVATAR })
    givenAccount({ image: OLD_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([])
  })
})

describe('one write per sign-in', () => {
  it('writes name and avatar together and logs only field names', async () => {
    givenUser({ name: 'Ada Old', image: OLD_AVATAR })
    givenAccount({ name: 'Ada Old', image: OLD_AVATAR })
    givenSignIn({ name: 'Ada New', image: NEW_AVATAR }, { email: 'you@example.com' })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ada New', image: NEW_AVATAR }])
    expect(mockSyncPrincipalProfile).toHaveBeenCalledTimes(1)
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(
      USER_ID,
      { displayName: 'Ada New', avatarUrl: NEW_AVATAR },
      tx
    )
    expect(mockLogInfo).toHaveBeenCalledTimes(1)
    expect(mockLogInfo).toHaveBeenCalledWith(
      { user_id: USER_ID, provider_id: PROVIDER, fields: ['name', 'image'] },
      'refreshed sso profile'
    )
    const logged = JSON.stringify(mockLogInfo.mock.calls)
    expect(logged).not.toContain('Ada')
    expect(logged).not.toContain('cdn.acme.test')
    expect(logged).not.toContain('example.com')
  })
})

describe('provenance record', () => {
  it('records values already in step, even while sync is off', async () => {
    givenUser({ name: 'Ada', image: NEW_AVATAR })
    givenSignIn({ name: 'Ada', image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([])
    expect(recordWrites()).toEqual([{ record: { name: 'Ada', image: NEW_AVATAR } }])
  })

  it('writes nothing when the record is unchanged', async () => {
    givenUser({ name: 'Ada', image: NEW_AVATAR })
    givenAccount({ name: 'Ada', image: NEW_AVATAR })
    givenSignIn({ name: 'Ada', image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(writes).toEqual([])
    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
  })

  it('lets sync turned on later refresh an account recorded while it was off', async () => {
    givenUser({ name: 'Ada' })
    givenSignIn({ name: 'Ada' })
    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())
    expect(recordWrites()).toEqual([{ record: { name: 'Ada' } }])

    writes.length = 0
    givenAccount({ name: 'Ada' })
    givenSignIn({ name: 'Ada New' })
    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ada New' }])
  })

  it('upserts one row per account, storing a field it no longer records as null', async () => {
    givenUser({ name: 'Ada (typed here)', image: NEW_AVATAR })
    givenAccount({ name: 'Ada', image: NEW_AVATAR })
    givenSignIn({ name: 'Ada New', image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    const upserts = writes.filter((w) => w.table === recordTable)
    expect(upserts).toHaveLength(1)
    const [upsert] = upserts
    expect(upsert.op).toBe('upsert')
    expect(upsert.values).toEqual({
      accountId: ACCOUNT_ROW_ID,
      name: null,
      image: NEW_AVATAR,
      updatedAt: expect.any(Date),
    })
    expect(upsert.conflict).toEqual({
      target: recordTable.accountId,
      set: { name: null, image: NEW_AVATAR, updatedAt: expect.any(Date) },
    })
  })

  it('keeps the row with nothing recorded, so the account stays tracked', async () => {
    givenUser({ name: 'Ada (typed here)' })
    givenAccount({ name: 'Ada' })
    givenSignIn({ name: 'Ada New' })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(mockDelete).not.toHaveBeenCalled()
    const [upsert] = writes.filter((w) => w.table === recordTable)
    expect(upsert).toMatchObject({
      op: 'upsert',
      values: { accountId: ACCOUNT_ROW_ID, name: null, image: null },
    })
  })

  it('starts tracking on the first sign-in even when nothing is provider-set', async () => {
    givenUser({ name: 'Ada (typed here)', image: CHOSEN_AVATAR })
    givenSignIn({ name: 'Ada', image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(recordWrites()).toEqual([{ record: {} }])
  })
})

describe('failure', () => {
  it('still fills an empty avatar when the record cannot be read', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })
    mockRecordFindFirst.mockRejectedValue(new Error('relation does not exist'))

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(userWrites()).toEqual([{ image: NEW_AVATAR }])
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(USER_ID, { avatarUrl: NEW_AVATAR }, tx)
    // Unknown state is left alone rather than overwritten, and is not a failure.
    expect(recordWrites()).toEqual([])
    expect(mockLogError).not.toHaveBeenCalled()
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'sso_profile_record_unreadable', user_id: USER_ID }),
      'sso profile record unreadable'
    )
  })

  it('treats an unreadable record as no record: only a generated name follows the provider', async () => {
    givenUser({ name: 'Ada Old' })
    givenSignIn({ name: 'Ada New' })
    mockRecordFindFirst.mockRejectedValue(new Error('relation does not exist'))

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([])
  })

  it('lets a generated name follow the provider when the record cannot be read', async () => {
    givenUser({ name: GENERATED })
    givenSignIn({ name: 'Ada New' })
    mockRecordFindFirst.mockRejectedValue(new Error('relation does not exist'))

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(userWrites()).toEqual([{ name: 'Ada New' }])
    expect(recordWrites()).toEqual([])
  })

  it('never blocks sign-in when the refresh cannot read or write', async () => {
    mockAccountFindFirst.mockRejectedValue(new Error('connection terminated'))

    await expect(
      handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())
    ).resolves.toBeUndefined()
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'sso_profile_refresh_failed', user_id: USER_ID }),
      'sso profile refresh failed'
    )
  })
})

describe('writing the user', () => {
  it('updates the user and the principal in one transaction', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(writes.filter((w) => w.table === userTable).map((w) => w.via)).toEqual(['tx'])
    expect(mockSyncPrincipalProfile).toHaveBeenCalledWith(USER_ID, { avatarUrl: NEW_AVATAR }, tx)
  })

  it('records nothing when the principal update fails', async () => {
    givenUser({ image: null })
    givenSignIn({ image: NEW_AVATAR })
    mockSyncPrincipalProfile.mockImplementationOnce(async () => {
      throw new Error('principal write failed')
    })

    await handleProfileRefreshAfter(ctx(), REGISTERED, providerRow())

    expect(recordWrites()).toEqual([])
    expect(mockLogInfo).not.toHaveBeenCalled()
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'sso_profile_refresh_failed' }),
      'sso profile refresh failed'
    )
  })

  it('updates only while the name, avatar and upload are still what it read', async () => {
    givenUser({ name: 'Ada Old', image: null, imageKey: null })
    givenAccount({ name: 'Ada Old' })
    givenSignIn({ name: 'Ada New', image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    const [update] = writes.filter((w) => w.table === userTable)
    expect(update.where).toEqual({
      op: 'and',
      parts: expect.arrayContaining([
        { op: 'eq', col: userTable.id, val: USER_ID },
        { op: 'eq', col: userTable.name, val: 'Ada Old' },
        { op: 'isNull', col: userTable.image },
        { op: 'isNull', col: userTable.imageKey },
      ]),
    })
    expect((update.where as { parts: unknown[] }).parts).toHaveLength(4)
  })

  it('compares a stored avatar by value', async () => {
    givenUser({ name: 'Ada', image: OLD_AVATAR, imageKey: null })
    givenAccount({ image: OLD_AVATAR })
    givenSignIn({ image: NEW_AVATAR })

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    const [update] = writes.filter((w) => w.table === userTable)
    expect((update.where as { parts: unknown[] }).parts).toContainEqual({
      op: 'eq',
      col: userTable.image,
      val: OLD_AVATAR,
    })
  })

  it('writes nothing more when a concurrent edit changed the user first', async () => {
    givenUser({ name: 'Ada Old', image: OLD_AVATAR })
    givenAccount({ name: 'Ada Old', image: OLD_AVATAR })
    givenSignIn({ name: 'Ada New', image: NEW_AVATAR })
    mockReturning.mockImplementation(async () => [])

    await handleProfileRefreshAfter(ctx(), REGISTERED, syncing())

    expect(mockSyncPrincipalProfile).not.toHaveBeenCalled()
    expect(recordWrites()).toEqual([])
    expect(mockLogInfo).not.toHaveBeenCalled()
    expect(mockLogWarn).not.toHaveBeenCalled()
    expect(mockLogError).not.toHaveBeenCalled()
  })
})
