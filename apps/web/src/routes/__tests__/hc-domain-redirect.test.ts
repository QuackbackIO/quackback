/**
 * The help center layout sends default-host visitors to the verified custom
 * domain, except inside the same-origin preview frame, whose bridge to the
 * designer only works while the frame stays on the designer's origin.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-start')>()
  // Run the server half, where the request's host is known.
  const createIsomorphicFn = () => {
    const builder = {
      client: () => builder,
      server: (fn: () => unknown) => fn,
    }
    return builder
  }
  return { ...actual, createIsomorphicFn }
})

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ host: 'app.example.com' }),
}))

const { Route } = await import('../_portal/hc')

type BeforeLoad = (ctx: {
  context: Record<string, unknown>
  location: { pathname: string; searchStr: string; search: Record<string, unknown> }
}) => Promise<unknown>
const beforeLoad = (Route as unknown as { options: { beforeLoad: BeforeLoad } }).options.beforeLoad

const context = {
  settings: {
    featureFlags: { helpCenter: true },
    helpCenterConfig: {
      domain: { domain: 'help.example.com', verifiedAt: '2026-07-01T00:00:00.000Z' },
    },
  },
}

async function run(search: Record<string, unknown>, searchStr: string) {
  try {
    await beforeLoad({ context, location: { pathname: '/hc/articles/a', searchStr, search } })
    return null
  } catch (thrown) {
    return thrown as { options?: { href?: string; statusCode?: number } }
  }
}

describe('help center custom domain redirect', () => {
  it('sends a visitor on the default host to the custom domain', async () => {
    const thrown = await run({}, '')
    expect(thrown?.options?.href).toBe('https://help.example.com/hc/articles/a')
    expect(thrown?.options?.statusCode).toBe(301)
  })

  it('keeps the designer preview frame on its own origin', async () => {
    expect(await run({ preview: true, designer: '1' }, '?preview=1&designer=1')).toBeNull()
  })

  it('keeps the settings preview frame on its own origin', async () => {
    expect(await run({ preview: '1' }, '?preview=1')).toBeNull()
  })
})
