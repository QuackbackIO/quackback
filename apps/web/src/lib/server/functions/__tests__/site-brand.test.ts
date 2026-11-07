/**
 * Use from your website reaches only those who manage branding, and reads
 * the site as given; without the permission nothing is read.
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

const state = vi.hoisted(() => ({ permissions: [] as string[], denied: false, read: vi.fn() }))
vi.mock('../auth-helpers', () => ({
  requireAuth: async (options: { permission: string }) => {
    state.permissions.push(options.permission)
    if (state.denied) throw new Error('forbidden')
    return { principal: { id: 'principal_1' } }
  },
}))
vi.mock('@/lib/server/domains/design/site/site-brand', () => ({ readSiteBrand: state.read }))

const { readSiteBrandFn } = await import('../site-brand')

beforeEach(() => {
  state.permissions = []
  state.denied = false
  state.read.mockReset().mockResolvedValue({ ok: false, code: 'NOTHING_FOUND', message: 'x' })
})

describe('readSiteBrandFn', () => {
  it('reads with the branding permission', async () => {
    const result = await readSiteBrandFn({ data: { url: 'acme.test' } } as never)
    expect(state.permissions).toEqual(['settings.branding'])
    expect(state.read).toHaveBeenCalledWith('acme.test')
    expect(result).toMatchObject({ ok: false, code: 'NOTHING_FOUND' })
  })

  it('reads nothing for someone without it', async () => {
    state.denied = true
    await expect(readSiteBrandFn({ data: { url: 'acme.test' } } as never)).rejects.toThrow()
    expect(state.read).not.toHaveBeenCalled()
  })
})
