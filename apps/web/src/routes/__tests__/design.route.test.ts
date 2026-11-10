/**
 * The /design route: the designer for those it lets in, sign-in for a
 * visitor, and back to the portal page for anyone else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ access: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (options: object) => Object.assign(new Error('redirect'), { redirect: options }),
}))
vi.mock('@/lib/server/functions/portal-designer', () => ({ getDesignerAccessFn: hoisted.access }))
vi.mock('@/components/designer/designer-shell', () => ({ DesignerShell: () => null }))

const { Route } = await import('../design')
type BeforeLoad = (ctx: object) => Promise<unknown>
const beforeLoad = (Route as unknown as { options: { beforeLoad: BeforeLoad } }).options.beforeLoad

async function open(path: string | undefined, engine = 'v2') {
  try {
    return await beforeLoad({
      search: { path },
      context: { settings: { portalDesign: { engine } } },
    })
  } catch (error) {
    return (error as { redirect: unknown }).redirect
  }
}

beforeEach(() => hoisted.access.mockReset())

describe('/design', () => {
  it('opens on the page someone came from', async () => {
    hoisted.access.mockResolvedValue({ ok: true })
    expect(await open('/feedback')).toEqual({ returnPath: '/feedback' })
  })

  it('sends a visitor to sign in and back here afterwards', async () => {
    hoisted.access.mockResolvedValue({ ok: false, reason: 'sign-in' })
    expect(await open('/feedback')).toEqual({
      to: '/admin/login',
      search: { callbackUrl: '/design?path=%2Ffeedback' },
    })
  })

  it('returns anyone else to the portal page, never to another site', async () => {
    hoisted.access.mockResolvedValue({ ok: false, reason: 'forbidden' })
    expect(await open('/roadmap')).toEqual({ href: '/roadmap' })
    expect(await open('//evil.example.com')).toEqual({ href: '/' })
    hoisted.access.mockResolvedValue({ ok: true })
    expect(await open('/roadmap', 'legacy')).toEqual({ href: '/roadmap' })
  })
})

describe('/design loader', () => {
  it('works out the canvas’s first page from the draft and the page someone came from', async () => {
    vi.doMock('@/lib/client/queries/portal-design', () => ({
      portalDesignQueries: { editor: () => 'editor', aiStatus: () => 'ai' },
    }))
    const { defaultDesign } = await import('@/lib/shared/design/schema')
    const design = defaultDesign()
    type Loader = (ctx: object) => Promise<{ canvas: string | null }>
    const loader = (Route as unknown as { options: { loader: Loader } }).options.loader
    const data = await loader({
      context: {
        returnPath: '/roadmap',
        settings: null,
        queryClient: {
          ensureQueryData: async (key: string) => (key === 'editor' ? { design } : {}),
        },
      },
    })
    expect(data.canvas).toBe('/roadmap?theme=light&preview=true&lang=en&designer=1&visitor=out')
  })
})

describe('/design search', () => {
  const validate = (
    Route as unknown as { options: { validateSearch: { parse: (s: object) => object } } }
  ).options.validateSearch

  it("keeps onboarding's brand match and where it came from", () => {
    expect(validate.parse({ match: 'acme.com', from: 'onboarding' })).toEqual({
      match: 'acme.com',
      from: 'onboarding',
    })
  })

  it("keeps onboarding's request to open publish", () => {
    expect(validate.parse({ publish: 'open', from: 'onboarding' })).toEqual({
      publish: 'open',
      from: 'onboarding',
    })
  })

  it('drops an entry it does not know', () => {
    expect(validate.parse({ from: 'elsewhere' })).toEqual({})
    expect(validate.parse({ publish: 'now' })).toEqual({})
  })
})

describe('/design head', () => {
  type Head = (ctx: object) => { links?: Array<{ rel: string; href: string }> }
  const head = (Route as unknown as { options: { head: Head } }).options.head
  const icon = (settings: object | null) =>
    head({ match: { context: { settings } } }).links?.find((l) => l.rel === 'icon')?.href

  // Without one, the browser asks for /favicon.ico, which 404s.
  it('fetches the canvas’s first page early, as the loader worked it out, and nothing without one', () => {
    const links = (loaderData: object | undefined) =>
      head({ match: { context: { settings: null } }, loaderData }).links ?? []
    expect(links({ canvas: '/roadmap?theme=light' })).toContainEqual({
      rel: 'prefetch',
      href: '/roadmap?theme=light',
      as: 'document',
    })
    expect(links({ canvas: null }).some((l) => l.rel === 'prefetch')).toBe(false)
    expect(links(undefined).some((l) => l.rel === 'prefetch')).toBe(false)
  })

  it('names an icon: the workspace favicon, else its logo, else the bundled one', () => {
    expect(icon({ faviconData: { url: '/f.png' }, brandingData: { logoUrl: '/l.png' } })).toBe(
      '/f.png'
    )
    expect(icon({ faviconData: null, brandingData: { logoUrl: '/l.png' } })).toBe('/l.png')
    expect(icon(null)).toBe('/logo.png')
  })
})
