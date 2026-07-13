import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  findSettings: vi.fn(),
  updateSettings: vi.fn(),
  setValues: vi.fn(),
  returning: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      query: { settings: { findFirst: hoisted.findSettings } },
      update: hoisted.updateSettings.mockImplementation(() => ({
        set: hoisted.setValues.mockImplementation(() => ({
          where: vi.fn(() => ({ returning: hoisted.returning })),
        })),
      })),
    },
  }
})

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.invalidate,
  requireSettings: vi.fn(),
  wrapDbError: vi.fn(),
  parseJsonConfig: vi.fn(),
  deepMerge: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  deleteObject: vi.fn(),
  getPublicUrlOrNull: vi.fn(),
}))

const { observeExternalWidgetRequest } = await import('../settings.widget')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.findSettings.mockResolvedValue({ id: 'workspace_1' })
  hoisted.returning.mockResolvedValue([{ id: 'workspace_1' }])
})

describe('observeExternalWidgetRequest writes', () => {
  it('records first and last observation evidence without invalidating settings cache', async () => {
    const now = new Date('2026-07-13T12:00:00.000Z')
    const observed = await observeExternalWidgetRequest(
      new Request('https://app.quackback.test/api/widget/config.json', {
        headers: { origin: 'https://Customer.Example:8443' },
      }),
      now
    )

    expect(observed).toBe(true)
    expect(hoisted.setValues).toHaveBeenCalledWith(
      expect.objectContaining({
        widgetInstalledLastSeenAt: now,
        widgetInstalledOriginHost: 'customer.example',
        widgetInstalledFirstSeenAt: expect.anything(),
      })
    )
    expect(hoisted.invalidate).not.toHaveBeenCalled()
  })

  it('does not touch the database for an originless native request', async () => {
    const observed = await observeExternalWidgetRequest(
      new Request('https://app.quackback.test/api/widget/config.json')
    )
    expect(observed).toBe(false)
    expect(hoisted.findSettings).not.toHaveBeenCalled()
    expect(hoisted.updateSettings).not.toHaveBeenCalled()
  })

  it('reports a throttled no-op when the conditional update changes no row', async () => {
    hoisted.returning.mockResolvedValue([])
    const observed = await observeExternalWidgetRequest(
      new Request('https://app.quackback.test/api/widget/config.json', {
        headers: { origin: 'https://customer.example' },
      })
    )
    expect(observed).toBe(false)
    expect(hoisted.setValues).toHaveBeenCalledOnce()
    expect(hoisted.invalidate).not.toHaveBeenCalled()
  })
})
