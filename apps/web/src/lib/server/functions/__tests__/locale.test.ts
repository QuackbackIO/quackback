/** The portal's language: the browser's, unless a preview asks for one the portal speaks. */
import { describe, expect, it, vi } from 'vitest'

const headers = vi.hoisted(() => ({ value: new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }) }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (data: unknown) => data
    const chain = {
      validator(fn: (data: unknown) => unknown) {
        validate = fn
        return chain
      },
      handler: (fn: (ctx: { data: unknown }) => unknown) => (args?: { data?: unknown }) =>
        fn({ data: validate(args?.data) }),
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => headers.value }))

const { getPortalLocaleFn } = await import('../locale')

describe('getPortalLocaleFn', () => {
  it("follows the browser's languages", async () => {
    expect(await getPortalLocaleFn()).toBe('fr')
  })

  it('draws a preview in the language it asks for, when the portal speaks it', async () => {
    expect(await getPortalLocaleFn({ data: { preferred: 'de' } })).toBe('de')
    expect(await getPortalLocaleFn({ data: { preferred: 'xx' } })).toBe('fr')
  })
})
