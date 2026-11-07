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

describe('/design head', () => {
  type Head = (ctx: object) => { links?: Array<{ rel: string; href: string }> }
  const head = (Route as unknown as { options: { head: Head } }).options.head
  const icon = (settings: object | null) =>
    head({ match: { context: { settings } } }).links?.find((l) => l.rel === 'icon')?.href

  // Without one, the browser asks for /favicon.ico, which 404s.
  it('names an icon: the workspace favicon, else its logo, else the bundled one', () => {
    expect(icon({ faviconData: { url: '/f.png' }, brandingData: { logoUrl: '/l.png' } })).toBe(
      '/f.png'
    )
    expect(icon({ faviconData: null, brandingData: { logoUrl: '/l.png' } })).toBe('/l.png')
    expect(icon(null)).toBe('/logo.png')
  })
})
