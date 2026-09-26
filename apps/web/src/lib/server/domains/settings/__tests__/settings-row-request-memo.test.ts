/**
 * The read-only settings getters share one read of the settings row per request.
 *
 * Office hours, ticket stage labels, the assistant settings and a dozen more
 * each parse their own slice of the same row, and a page asks for several of
 * them. These tests prove one database read serves them all within a request,
 * each caller still gets a copy of its own, an invalidation in the same
 * request is honoured, the next request reads again, and work outside a
 * request (the workflow engine, sweeps) still reads every time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/kv/pg-kv', () => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  kvDel: vi.fn(async () => undefined),
}))

const mockFindFirst = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: { settings: { findFirst: (...args: unknown[]) => mockFindFirst(...args) } },
  },
}))

const { getOfficeHoursSchedule } = await import('../settings.office-hours')
const { getStageLabels } = await import('../settings.tickets')
const { requireSettings, requireSettingsPerRequest, invalidateSettingsCache } =
  await import('../settings.helpers')
const { runWithLogContext } = await import('@/lib/server/log-context')

function row(name: string) {
  return { id: 'settings_1', name, metadata: null }
}

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: crypto.randomUUID() }, fn)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(row('First'))
})

describe('the settings row within a request', () => {
  it('is read once however many getters ask', async () => {
    await inRequest(async () => {
      await Promise.all([getOfficeHoursSchedule(), getStageLabels()])
      await getOfficeHoursSchedule()
    })
    expect(mockFindFirst).toHaveBeenCalledTimes(1)
  })

  it('hands every caller a copy of its own', async () => {
    const second = await inRequest(async () => {
      const first = await requireSettingsPerRequest()
      first.name = 'mutated by a caller'
      return requireSettingsPerRequest()
    })
    expect(second.name).toBe('First')
  })

  it('is read again after an invalidation in the same request', async () => {
    const names = await inRequest(async () => {
      const before = await requireSettingsPerRequest()
      mockFindFirst.mockResolvedValue(row('Renamed'))
      await invalidateSettingsCache()
      const after = await requireSettingsPerRequest()
      return [before.name, after.name]
    })
    expect(names).toEqual(['First', 'Renamed'])
    expect(mockFindFirst).toHaveBeenCalledTimes(2)
  })

  it('is read again in the next request', async () => {
    await inRequest(() => requireSettingsPerRequest())
    mockFindFirst.mockResolvedValue(row('Later'))
    expect((await inRequest(() => requireSettingsPerRequest())).name).toBe('Later')
  })

  it('is read every time outside a request', async () => {
    await getOfficeHoursSchedule()
    await getOfficeHoursSchedule()
    expect(mockFindFirst).toHaveBeenCalledTimes(2)
  })

  it('stays a fresh read for a read-modify-write', async () => {
    await inRequest(async () => {
      await requireSettingsPerRequest()
      await requireSettings()
      await requireSettings()
    })
    expect(mockFindFirst).toHaveBeenCalledTimes(3)
  })

  it('refuses a workspace without a settings row', async () => {
    mockFindFirst.mockResolvedValue(undefined)
    await expect(inRequest(() => requireSettingsPerRequest())).rejects.toMatchObject({
      code: 'SETTINGS_NOT_FOUND',
    })
  })
})
