import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockOnConflictDoNothing = vi.fn()
const mockOnConflictDoUpdate = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockSubFindFirst = vi.fn()
const mockGetChangelogSettings = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.changelog', () => ({
  getChangelogSettings: () => mockGetChangelogSettings(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogSubscriptions: { findFirst: (...args: unknown[]) => mockSubFindFirst(...args) },
    },
    insert: () => ({
      values: (values: unknown) => {
        mockInsertValues(values)
        return {
          onConflictDoNothing: (...args: unknown[]) => mockOnConflictDoNothing(...args),
          onConflictDoUpdate: (...args: unknown[]) => mockOnConflictDoUpdate(...args),
        }
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mockUpdateSet(values)
        return { where: (...args: unknown[]) => mockUpdateWhere(...args) }
      },
    }),
  },
  eq: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ kind: 'sql', strings: Array.from(strings) })),
    { raw: vi.fn() }
  ),
}))

const PRINCIPAL_ID = 'principal_01user' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  mockGetChangelogSettings.mockResolvedValue({ autoSubscribe: true, emailsDisabled: false })
})

describe('ensureAutoSubscribed', () => {
  it('is a no-op when autoSubscribe is off', async () => {
    mockGetChangelogSettings.mockResolvedValue({ autoSubscribe: false, emailsDisabled: false })
    const { ensureAutoSubscribed } = await import('../changelog-subscription.service')

    await ensureAutoSubscribed(PRINCIPAL_ID)

    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('inserts a source=auto row with onConflictDoNothing when autoSubscribe is on', async () => {
    const { ensureAutoSubscribed } = await import('../changelog-subscription.service')

    await ensureAutoSubscribed(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({ principalId: PRINCIPAL_ID, source: 'auto' })
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1)
  })
})

describe('subscribeSelfServe / subscribeAdmin', () => {
  it('upserts with onConflictDoUpdate clearing unsubscribedAt', async () => {
    const { subscribeSelfServe } = await import('../changelog-subscription.service')

    await subscribeSelfServe(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({
      principalId: PRINCIPAL_ID,
      source: 'self_serve',
    })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { unsubscribedAt: null } })
    )
  })

  it('subscribeAdmin uses source=admin', async () => {
    const { subscribeAdmin } = await import('../changelog-subscription.service')

    await subscribeAdmin(PRINCIPAL_ID)

    expect(mockInsertValues).toHaveBeenCalledWith({ principalId: PRINCIPAL_ID, source: 'admin' })
  })
})

describe('unsubscribeChangelog', () => {
  it('stamps unsubscribedAt without deleting the row', async () => {
    const { unsubscribeChangelog } = await import('../changelog-subscription.service')

    await unsubscribeChangelog(PRINCIPAL_ID)

    expect(mockUpdateSet).toHaveBeenCalledWith({ unsubscribedAt: expect.any(Date) })
  })
})

describe('getChangelogSubscriptionStatus', () => {
  it('reports unsubscribed=false shape when no row exists', async () => {
    mockSubFindFirst.mockResolvedValueOnce(undefined)
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status).toEqual({
      principalId: PRINCIPAL_ID,
      subscribed: false,
      source: null,
      unsubscribedAt: null,
    })
  })

  it('subscribed=true when unsubscribedAt is null on an existing row', async () => {
    mockSubFindFirst.mockResolvedValueOnce({
      principalId: PRINCIPAL_ID,
      source: 'auto',
      unsubscribedAt: null,
    })
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status.subscribed).toBe(true)
  })

  it('subscribed=false when unsubscribedAt is set', async () => {
    const unsubscribedAt = new Date('2026-01-01')
    mockSubFindFirst.mockResolvedValueOnce({
      principalId: PRINCIPAL_ID,
      source: 'self_serve',
      unsubscribedAt,
    })
    const { getChangelogSubscriptionStatus } = await import('../changelog-subscription.service')

    const status = await getChangelogSubscriptionStatus(PRINCIPAL_ID)

    expect(status.subscribed).toBe(false)
    expect(status.unsubscribedAt).toBe(unsubscribedAt)
  })
})

describe('importChangelogSubscribersFromEmails', () => {
  it('returns all-zero result for an empty input', async () => {
    const { importChangelogSubscribersFromEmails } = await import(
      '../changelog-subscription.service'
    )

    const result = await importChangelogSubscribersFromEmails([])

    expect(result).toEqual({ imported: 0, skipped: 0, total: 0 })
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
