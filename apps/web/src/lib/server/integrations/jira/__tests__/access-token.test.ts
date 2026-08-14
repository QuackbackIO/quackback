import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  decryptSecrets: vi.fn(),
  encryptSecrets: vi.fn((s: unknown) => JSON.stringify(s)),
  lockedRows: vi.fn(),
  forUpdate: vi.fn(),
  updateWhere: vi.fn(),
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
  refreshJiraToken: vi.fn(),
  getPlatformCredentials: vi.fn(),
  cacheDel: vi.fn(),
}))

vi.mock('../../encryption', () => ({
  decryptSecrets: (...args: unknown[]) => hoisted.decryptSecrets(...args),
  encryptSecrets: (...args: unknown[]) => hoisted.encryptSecrets(...args),
}))

vi.mock('@/lib/server/db', () => {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: (mode: string) => {
            hoisted.forUpdate(mode)
            return hoisted.lockedRows()
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({ where: (...args: unknown[]) => hoisted.updateWhere(...args) }),
    }),
  }
  return {
    db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
    integrations: {
      id: 'id',
      integrationType: 'integrationType',
      secrets: 'secrets',
      config: 'config',
    },
    eq: (...args: unknown[]) => hoisted.eq(...args),
  }
})

vi.mock('../oauth', () => ({
  refreshJiraToken: (...args: unknown[]) => hoisted.refreshJiraToken(...args),
}))

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: (...args: unknown[]) => hoisted.getPlatformCredentials(...args),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => hoisted.cacheDel(...args),
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'hooks:integration-mappings' },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}))

const { getJiraAccessToken } = await import('../access-token')

const ID = 'int_jira1'
const expired = new Date(Date.now() - 60_000).toISOString()
const fresh = new Date(Date.now() + 60 * 60_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.decryptSecrets.mockImplementation((s: string) => JSON.parse(s))
  hoisted.getPlatformCredentials.mockResolvedValue({ clientId: 'id', clientSecret: 'sec' })
  hoisted.refreshJiraToken.mockResolvedValue({
    accessToken: 'new-tok',
    refreshToken: 'new-rt',
    expiresIn: 3600,
  })
  hoisted.updateWhere.mockResolvedValue(undefined)
  hoisted.cacheDel.mockResolvedValue(undefined)
})

describe('getJiraAccessToken', () => {
  it('returns the current token when it is not expiring', async () => {
    const token = await getJiraAccessToken({
      id: ID,
      secrets: JSON.stringify({ accessToken: 'tok', refreshToken: 'rt' }),
      config: { tokenExpiresAt: fresh },
    })

    expect(token).toBe('tok')
    expect(hoisted.forUpdate).not.toHaveBeenCalled()
    expect(hoisted.refreshJiraToken).not.toHaveBeenCalled()
  })

  it('does not refresh without a row id', async () => {
    const token = await getJiraAccessToken({
      secrets: JSON.stringify({ accessToken: 'tok', refreshToken: 'rt' }),
      config: { tokenExpiresAt: expired },
    })

    expect(token).toBe('tok')
    expect(hoisted.refreshJiraToken).not.toHaveBeenCalled()
    expect(hoisted.updateWhere).not.toHaveBeenCalled()
  })

  it('uses a locked already-rotated row instead of replaying the cached refresh token', async () => {
    hoisted.lockedRows.mockResolvedValue([
      {
        secrets: JSON.stringify({ accessToken: 'db-tok', refreshToken: 'db-rt' }),
        config: { cloudId: 'c', tokenExpiresAt: fresh },
      },
    ])

    const token = await getJiraAccessToken({
      id: ID,
      secrets: JSON.stringify({ accessToken: 'stale-tok', refreshToken: 'stale-rt' }),
      config: { tokenExpiresAt: expired },
    })

    expect(token).toBe('db-tok')
    expect(hoisted.forUpdate).toHaveBeenCalledWith('update')
    expect(hoisted.refreshJiraToken).not.toHaveBeenCalled()
    expect(hoisted.updateWhere).not.toHaveBeenCalled()
  })

  it('refreshes under a row lock, by integration id, and drops the mappings cache', async () => {
    hoisted.lockedRows.mockResolvedValue([
      {
        secrets: JSON.stringify({ accessToken: 'stale-tok', refreshToken: 'stale-rt' }),
        config: { cloudId: 'c', tokenExpiresAt: expired },
      },
    ])

    const token = await getJiraAccessToken({
      id: ID,
      secrets: JSON.stringify({ accessToken: 'stale-tok', refreshToken: 'stale-rt' }),
      config: { tokenExpiresAt: expired },
    })

    expect(token).toBe('new-tok')
    expect(hoisted.forUpdate).toHaveBeenCalledWith('update')
    expect(hoisted.refreshJiraToken).toHaveBeenCalledWith('stale-rt', {
      clientId: 'id',
      clientSecret: 'sec',
    })
    expect(hoisted.updateWhere).toHaveBeenCalledWith({ col: 'id', val: ID })
    expect(hoisted.eq).not.toHaveBeenCalledWith('integrationType', 'jira')
    expect(hoisted.cacheDel).toHaveBeenCalledWith('hooks:integration-mappings')
  })
})
