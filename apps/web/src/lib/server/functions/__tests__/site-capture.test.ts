/**
 * Website captures reach only signed-in admins: read_website needs the
 * branding permission and runs as the person asking (their limits), and the
 * month's usage needs settings management. Without either, nothing runs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => handler!(args)
    fn.validator = () => fn
    fn.handler = (h: typeof handler) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  denied: false,
  read: vi.fn(),
  usage: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: async (options: { permission: string }) => {
    state.permissions.push(options.permission)
    if (state.denied) throw new Error('forbidden')
    return { principal: { id: 'principal_1' } }
  },
}))
vi.mock('@/lib/server/domains/design/site/website-reading', () => ({ readWebsite: state.read }))
vi.mock('@/lib/server/domains/design/site/capture-service', () => ({ captureUsage: state.usage }))
vi.mock('@/lib/server/config', () => ({ config: { screenshotoneAccessKey: undefined } }))

const { readWebsiteFn, siteCaptureUsageFn } = await import('../site-capture')

beforeEach(() => {
  state.permissions = []
  state.denied = false
  state.read.mockReset().mockResolvedValue({ reading: { ok: true }, capture: null })
  state.usage.mockReset().mockResolvedValue({ used: 3, limit: 90, month: '2026-11' })
})

describe('readWebsiteFn', () => {
  it('reads as the admin asking, with the branding permission', async () => {
    await readWebsiteFn({ data: { url: 'acme.test' } } as never)
    expect(state.permissions).toEqual(['settings.branding'])
    expect(state.read).toHaveBeenCalledWith('acme.test', 'principal_1')
  })

  it('reads nothing for someone without it', async () => {
    state.denied = true
    await expect(readWebsiteFn({ data: { url: 'acme.test' } } as never)).rejects.toThrow()
    expect(state.read).not.toHaveBeenCalled()
  })
})

describe('siteCaptureUsageFn', () => {
  it('says the month’s captures to those who manage settings', async () => {
    expect(await siteCaptureUsageFn({ data: undefined } as never)).toEqual({
      configured: false,
      used: 3,
      limit: 90,
      month: '2026-11',
    })
    expect(state.permissions).toEqual(['settings.manage'])
  })
})
