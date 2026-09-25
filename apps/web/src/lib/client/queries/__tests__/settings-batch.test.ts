// @vitest-environment happy-dom
/**
 * A settings loader's reads, asked for together, cost one request, and each
 * lands in the cache as if it had been fetched alone: under its own key and
 * options, shaped by its own query function. Nothing about a read's outcome
 * changes: a read the caller may not make fails with the error it fails with
 * alone, and does not take the others with it.
 *
 * The server functions run in process, as the batch runs them on the server,
 * behind stand-ins that admit only the permissions the caller holds.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const { held, ran } = vi.hoisted(() => ({
  held: { permissions: new Set<string>() },
  /** Every server function call that got past its gate, by read. */
  ran: [] as string[],
}))

function gated<T>(permission: string, name: string, value: T) {
  return vi.fn(async () => {
    if (!held.permissions.has(permission)) {
      throw new Error(`Access denied: Requires permission '${permission}'`)
    }
    ran.push(name)
    return structuredClone(value)
  })
}

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})
vi.mock('@/lib/server/functions/roles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/roles')>()),
  listRolesFn: gated('member.view', 'roles', { roles: [], maxCustomRoles: null }),
}))
vi.mock('@/lib/server/functions/teams', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/teams')>()),
  listTeamsAdminFn: gated('team.manage', 'teams', [{ id: 'team_1', name: 'Support' }]),
}))
vi.mock('@/lib/server/functions/api-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/api-keys')>()),
  fetchApiKeys: gated('api_key.manage', 'apiKeys', [
    {
      id: 'api_key_1',
      name: 'CI',
      createdAt: '2026-09-01T00:00:00.000Z',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    },
  ]),
}))
vi.mock('@/lib/server/functions/settings-reads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/functions/settings-reads')>()
  return { ...actual, readSettingsTogetherFn: vi.fn(actual.readSettingsTogetherFn) }
})

// The registry the batched reads run from pulls in every query module; paid
// here, at file load, rather than inside the first test's timed body.
await import('@/lib/server/settings-read-registry')
const { settingsReadBatch } = await import('../settings-batch')
const { settingsQueries } = await import('../settings')
const { adminQueries } = await import('../admin')
const { readSettingsTogetherFn } = await import('@/lib/server/functions/settings-reads')
const batches = vi.mocked(readSettingsTogetherFn)

const EVERYTHING = [PERMISSIONS.MEMBER_VIEW, PERMISSIONS.TEAM_MANAGE, PERMISSIONS.API_KEY_MANAGE]
// A default unlike any read's own staleTime, so a read held under the
// defaults rather than its own options shows.
const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 1_000, retry: false } } })

let client: QueryClient
beforeEach(() => {
  ran.length = 0
  batches.mockClear()
  held.permissions = new Set(EVERYTHING)
  client = newClient()
})

describe('settingsReadBatch', () => {
  it('fetches the reads a loader asks for together in one request, each once', async () => {
    const ensure = settingsReadBatch(client)
    await Promise.all([
      ensure(settingsQueries.roles()),
      ensure(settingsQueries.teams()),
      ensure(adminQueries.apiKeys()),
    ])
    expect(batches).toHaveBeenCalledTimes(1)
    expect(ran.sort()).toEqual(['apiKeys', 'roles', 'teams'])
  })

  it('fills each read as fetching it alone would: same data, key and options', async () => {
    const ensure = settingsReadBatch(client)
    const [, keys] = await Promise.all([
      ensure(settingsQueries.roles()),
      ensure(adminQueries.apiKeys()),
    ])
    // The query's own function shaped it (its dates are dates).
    expect(keys).toEqual(await newClient().ensureQueryData(adminQueries.apiKeys()))
    expect(keys[0]!.createdAt).toBeInstanceOf(Date)

    const query = client.getQueryCache().find({ queryKey: adminQueries.apiKeys().queryKey })!
    expect((query.options as { staleTime?: unknown }).staleTime).toBe(
      adminQueries.apiKeys().staleTime
    )
    expect(query.state.status).toBe('success')
    // It refetches through its own function, as a fetched query would.
    ran.length = 0
    await client.refetchQueries({ queryKey: adminQueries.apiKeys().queryKey, type: 'all' })
    expect(ran).toEqual(['apiKeys'])
  })

  it('fails a read the caller may not make alone, with the error it fails with alone', async () => {
    held.permissions = new Set([PERMISSIONS.MEMBER_VIEW])
    const alone = await newClient()
      .ensureQueryData(settingsQueries.teams())
      .catch((error: Error) => error.message)

    const ensure = settingsReadBatch(client)
    const [roles, teams] = await Promise.allSettled([
      ensure(settingsQueries.roles()),
      ensure(settingsQueries.teams()),
    ])
    expect(roles.status).toBe('fulfilled')
    expect(teams.status).toBe('rejected')
    expect((teams as PromiseRejectedResult).reason.message).toBe(alone)
    expect(alone).toBe("Access denied: Requires permission 'team.manage'")
    expect(ran).toEqual(['roles'])
  })

  it('reads nothing already cached, and sends a lone read on its own', async () => {
    await client.ensureQueryData(settingsQueries.roles())
    ran.length = 0
    const ensure = settingsReadBatch(client)
    await Promise.all([ensure(settingsQueries.roles()), ensure(settingsQueries.teams())])
    expect(batches).not.toHaveBeenCalled()
    expect(ran).toEqual(['teams'])
  })

  it('joins a read already on its way in another batch rather than sending it again', async () => {
    // A hover's preload and the click after it run the same loader twice.
    const preload = settingsReadBatch(client)
    const navigation = settingsReadBatch(client)
    await Promise.all([
      preload(settingsQueries.roles()),
      preload(settingsQueries.teams()),
      navigation(settingsQueries.roles()),
      navigation(settingsQueries.teams()),
    ])
    expect(batches).toHaveBeenCalledTimes(1)
    expect(ran.sort()).toEqual(['roles', 'teams'])
  })

  it('fetches a read the server does not know on its own', async () => {
    const unregistered = {
      queryKey: ['settings', 'not-a-batched-read'],
      queryFn: gated('member.view', 'unregistered', { value: 1 }),
    }
    const ensure = settingsReadBatch(client)
    const [, value] = await Promise.all([ensure(settingsQueries.roles()), ensure(unregistered)])
    expect(value).toEqual({ value: 1 })
    expect(batches).toHaveBeenCalledTimes(1)
    expect(ran.sort()).toEqual(['roles', 'unregistered'])
  })
})

describe('readSettingsTogetherFn', () => {
  it('answers each read behind its own gate, and nothing it does not know', async () => {
    held.permissions = new Set([PERMISSIONS.MEMBER_VIEW])
    const results = await readSettingsTogetherFn({
      data: {
        reads: [
          [...settingsQueries.roles().queryKey],
          [...settingsQueries.teams().queryKey],
          ['settings', 'not-a-batched-read'],
        ],
      },
    })
    expect(results).toEqual([
      { ok: true, data: { roles: [], maxCustomRoles: null } },
      { ok: false },
      { ok: false },
    ])
  })

  it('keeps nothing between requests', async () => {
    const reads = [[...settingsQueries.roles().queryKey]]
    await readSettingsTogetherFn({ data: { reads } })
    await readSettingsTogetherFn({ data: { reads } })
    expect(ran).toEqual(['roles', 'roles'])
  })
})
