/**
 * Who may open the portal designer and what only it is served: the item
 * picker's posts and sample content. Whatever the answer, nothing is cached
 * or indexed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { SAMPLE_PAGES, type SamplePage } from '@/lib/shared/design/sample-pages'

const hoisted = vi.hoisted(() => ({
  auth: vi.fn(),
  flags: {} as Record<string, boolean>,
  headers: new Map<string, string>(),
  handlers: [] as Array<(input?: unknown) => Promise<unknown>>,
  posts: vi.fn(async () => [{ id: 'post_1', title: 'Public idea', path: '/b/ideas/posts/post_1' }]),
  places: vi.fn(async () => ({ boards: [{ id: 'b', name: 'Ideas', slug: 'ideas' }] })),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler(fn: (input?: unknown) => Promise<unknown>) {
        hoisted.handlers.push(fn)
        return fn
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (name: string, value: string) => hoisted.headers.set(name, value),
}))
vi.mock('../auth-helpers', () => ({ getOptionalAuth: hoisted.auth }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async (flag: string) => hoisted.flags[flag] === true,
}))

vi.mock('@/lib/server/domains/design/designer-posts', () => ({
  listDesignerPosts: hoisted.posts,
}))
vi.mock('@/lib/server/domains/design/designer-places', () => ({
  listDesignerPlaces: hoisted.places,
}))

await import('../portal-designer')
const [access, designerPosts, sample, designerPlaces] = hoisted.handlers as [
  () => Promise<unknown>,
  () => Promise<unknown>,
  (input: { data: { page: SamplePage } }) => Promise<unknown>,
  () => Promise<unknown>,
]

function signedIn(permissions: string[], type = 'user') {
  hoisted.auth.mockResolvedValue({ principal: { type, role: 'admin' }, permissions })
}

beforeEach(() => {
  hoisted.headers.clear()
  hoisted.auth.mockReset()
  hoisted.posts.mockClear()
  hoisted.places.mockClear()
  hoisted.flags = { portalDesignV2: true }
})

describe('getDesignerAccessFn', () => {
  it('lets in someone who may change the branding while both switches are on', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    expect(await access()).toEqual({ ok: true })
  })

  it('asks a visitor or an anonymous session to sign in', async () => {
    hoisted.auth.mockResolvedValue(null)
    expect(await access()).toEqual({ ok: false, reason: 'sign-in' })
    signedIn([PERMISSIONS.SETTINGS_BRANDING], 'anonymous')
    expect(await access()).toEqual({ ok: false, reason: 'sign-in' })
  })

  it('turns away a teammate who may not change the branding', async () => {
    signedIn([PERMISSIONS.SETTINGS_MANAGE])
    expect(await access()).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('is closed while the new portal design is off', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    hoisted.flags = { portalDesignV2: false }
    expect(await access()).toEqual({ ok: false, reason: 'off' })
  })

  it('is never cached or indexed, even when it turns someone away', async () => {
    hoisted.auth.mockResolvedValue(null)
    await access()
    expect(hoisted.headers.get('Cache-Control')).toBe('private, no-store')
    expect(hoisted.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('listDesignerPostsFn', () => {
  it('lists the picker posts for someone who may open the designer', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    expect(await designerPosts()).toEqual({
      ok: true,
      posts: [{ id: 'post_1', title: 'Public idea', path: '/b/ideas/posts/post_1' }],
    })
  })

  it('lists nothing for anyone else', async () => {
    signedIn([PERMISSIONS.SETTINGS_MANAGE])
    expect(await designerPosts()).toEqual({ ok: false, reason: 'forbidden' })
    hoisted.auth.mockResolvedValue(null)
    expect(await designerPosts()).toEqual({ ok: false, reason: 'sign-in' })
    expect(hoisted.posts).not.toHaveBeenCalled()
  })
})

describe('getDesignerSampleFn', () => {
  it('serves the sample, marked as such, to someone who may open the designer only', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    const served = (await sample({ data: { page: 'status' } })) as {
      ok: true
      sample: { page: string; status: { snapshot: { activeIncidents: Array<{ id: string }> } } }
    }
    expect(served.ok).toBe(true)
    expect(served.sample.page).toBe('status')
    expect(served.sample.status.snapshot.activeIncidents[0]!.id).toMatch(/^sample_/)
    expect(hoisted.headers.get('Cache-Control')).toBe('private, no-store')
    expect(hoisted.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(hoisted.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'")
  })

  it('serves every sample page', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    for (const page of SAMPLE_PAGES) {
      const served = (await sample({ data: { page } })) as { ok: true; sample: { page: string } }
      expect(served.sample.page).toBe(page)
    }
  })

  it('refuses anyone who may not change the branding, or with the designer off', async () => {
    signedIn([PERMISSIONS.SETTINGS_MANAGE])
    expect(await sample({ data: { page: 'support' } })).toEqual({
      ok: false,
      reason: 'forbidden',
    })
    expect(await sample({ data: { page: 'help' } })).toEqual({ ok: false, reason: 'forbidden' })
    hoisted.auth.mockResolvedValue(null)
    expect(await sample({ data: { page: 'help' } })).toEqual({ ok: false, reason: 'sign-in' })
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    hoisted.flags = { portalDesignV2: false }
    expect(await sample({ data: { page: 'help' } })).toEqual({ ok: false, reason: 'off' })
  })
})

describe('listDesignerPlacesFn', () => {
  it('lists the switcher places for someone who may open the designer', async () => {
    signedIn([PERMISSIONS.SETTINGS_BRANDING])
    expect(await designerPlaces()).toEqual({
      ok: true,
      places: { boards: [{ id: 'b', name: 'Ideas', slug: 'ideas' }] },
    })
    expect(hoisted.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('lists nothing for anyone else', async () => {
    signedIn([PERMISSIONS.SETTINGS_MANAGE])
    expect(await designerPlaces()).toEqual({ ok: false, reason: 'forbidden' })
    hoisted.auth.mockResolvedValue(null)
    expect(await designerPlaces()).toEqual({ ok: false, reason: 'sign-in' })
    expect(hoisted.places).not.toHaveBeenCalled()
  })
})
