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

function requestWithOrigin(
  origin: string,
  url = 'https://app.quackback.test/api/widget/config.json'
): Request {
  // happy-dom drops `origin` from init headers (forbidden-header list); set it
  // after construction to emulate the browser-set header — see
  // widget-observation.test.ts.
  const req = new Request(url)
  req.headers.set('origin', origin)
  return req
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.findSettings.mockResolvedValue({ id: 'workspace_1' })
  hoisted.returning.mockResolvedValue([{ id: 'workspace_1' }])
})

describe('observeExternalWidgetRequest writes', () => {
  it('records first and last observation evidence without invalidating settings cache', async () => {
    const now = new Date('2026-07-13T12:00:00.000Z')
    const observed = await observeExternalWidgetRequest(
      requestWithOrigin('https://Customer.Example:8443'),
      now
    )

    expect(observed).toBe(true)
    expect(hoisted.setValues).toHaveBeenCalledWith(
      expect.objectContaining({
        widgetInstalledLastSeenAt: now,
        widgetInstalledOriginHost: 'customer.example',
        widgetInstalledFirstSeenAt: expect.anything(),
        widgetInstalledSdkVersion: null,
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

  it('stores the sdk query param from a config.json ping', async () => {
    await observeExternalWidgetRequest(
      requestWithOrigin(
        'https://customer.example',
        'https://app.quackback.test/api/widget/config.json?sdk=0.1.5'
      ),
      new Date('2026-07-13T12:00:00.000Z')
    )
    expect(hoisted.setValues).toHaveBeenCalledWith(
      expect.objectContaining({ widgetInstalledSdkVersion: '0.1.5' })
    )
  })

  it('records the instance SDK version for a script-tag sdk.js fetch', async () => {
    const req = new Request('https://app.quackback.test/api/widget/sdk.js')
    req.headers.set('origin', 'https://customer.example')
    await observeExternalWidgetRequest(req, new Date('2026-07-13T12:00:00.000Z'))
    expect(hoisted.setValues).toHaveBeenCalledWith(
      expect.objectContaining({
        widgetInstalledSdkVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      })
    )
  })

  it('reports a throttled no-op when the conditional update changes no row', async () => {
    hoisted.returning.mockResolvedValue([])
    const observed = await observeExternalWidgetRequest(
      requestWithOrigin('https://customer.example')
    )
    expect(observed).toBe(false)
    expect(hoisted.setValues).toHaveBeenCalledOnce()
    expect(hoisted.invalidate).not.toHaveBeenCalled()
  })
})
