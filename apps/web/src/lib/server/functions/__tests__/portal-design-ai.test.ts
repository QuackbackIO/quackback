/**
 * Quackback AI in Appearance needs the branding permission. A request that
 * changes something saves the draft for the person who asked; one that
 * changes nothing leaves the draft alone. A website that cannot be read is a
 * refusal, not a guess.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({
  handlers: [] as Handler[],
  saved: [] as Array<{ design: unknown; author: unknown }>,
  answer: null as unknown,
  site: null as unknown,
  logoKey: null as string | null,
  branding: null as null | { domain: string; logoKey: string; quality: 'good' | 'weak' },
  savedLogos: [] as string[],
  directionsInput: null as unknown,
  imported: [] as unknown[],
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler(fn: Handler) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'user-agent': 'vitest' }),
}))
const requireAuth = vi.fn()
vi.mock('../auth-helpers', () => ({ requireAuth: (...args: unknown[]) => requireAuth(...args) }))
vi.mock('@/lib/server/audit/log', () => ({ actorFromAuth: () => ({ kind: 'person' }) }))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDesignForEditing: async () => ({ design: defaultDesign() }),
  saveDesignDraft: async (design: unknown, author: unknown) => {
    hoisted.saved.push({ design, author })
    return { ok: true, report: { adjustments: [], errors: [] } }
  },
}))
vi.mock('@/lib/server/domains/design/ai/design-ai', () => ({
  designAiModel: () => 'test-model',
  askDesignAi: async () => hoisted.answer,
  designDirections: async (input: unknown) => {
    hoisted.directionsInput = input
    return { ok: true, looks: [] }
  },
}))
vi.mock('@/lib/server/domains/design/ai/site-assets', () => ({
  importSiteAssets: async (signals: unknown) => {
    hoisted.imported.push(signals)
    return { wordmark: { key: 'header-logos/site-a.svg', colours: [] }, shareImage: null }
  },
}))
vi.mock('@/lib/server/domains/design/ai/site-signals', () => ({
  readSiteSignals: async () => hoisted.site,
}))
// What the workspace allows Quackback AI to bring in.
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => ({
    name: 'Example',
    featureFlags: { feedback: true },
    settings: { logoKey: hoisted.logoKey },
  }),
}))
vi.mock('@/lib/server/content/website-branding', () => ({
  fetchWebsiteBranding: async () => hoisted.branding,
}))
vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  saveLogoKey: async (key: string) => {
    hoisted.savedLogos.push(key)
    return { success: true, key }
  },
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({ assertTierFeature: async () => {} }))
vi.mock('@/lib/server/config', () => ({ config: { portalDesignAiCss: false } }))

await import('../portal-design-ai')
const [statusFn, askFn, directionsFn] = hoisted.handlers

beforeEach(() => {
  hoisted.saved = []
  hoisted.directionsInput = null
  hoisted.imported = []
  requireAuth.mockReset()
  requireAuth.mockResolvedValue({
    principal: { id: 'principal_1' },
    permissions: ['settings.branding', 'settings.manage'],
  })
  hoisted.logoKey = null
  hoisted.branding = null
  hoisted.savedLogos = []
})

describe('portal design AI functions', () => {
  it('each needs the branding permission', async () => {
    requireAuth.mockRejectedValue(new Error('forbidden'))
    await expect(statusFn({ data: {} })).rejects.toThrow('forbidden')
    await expect(askFn({ data: { message: 'x', scope: 'site', history: [] } })).rejects.toThrow()
    await expect(directionsFn({ data: { words: 'calm' } })).rejects.toThrow()
    expect(requireAuth).toHaveBeenCalledTimes(3)
    expect(requireAuth.mock.calls.every(([gate]) => gate.permission === 'settings.branding')).toBe(
      true
    )
    expect(hoisted.saved).toEqual([])
  })

  it('saves the changed draft for the person who asked', async () => {
    const design = defaultDesign()
    design.layout.density = 'compact'
    hoisted.answer = {
      ok: true,
      reply: 'Done.',
      design,
      applied: [{ path: 'layout.density', before: 'comfortable', after: 'compact' }],
      skipped: 0,
      readability: [],
    }
    const result = await askFn({ data: { message: 'Tighter', scope: 'feed', history: [] } })
    expect(hoisted.saved).toHaveLength(1)
    expect(hoisted.saved[0].design).toBe(design)
    expect(hoisted.saved[0].author).toMatchObject({ principalId: 'principal_1' })
    expect(result).toMatchObject({ ok: true, report: { errors: [] } })
  })

  it('leaves the draft alone when nothing changed', async () => {
    hoisted.answer = {
      ok: true,
      reply: 'That is not about the look.',
      design: defaultDesign(),
      applied: [],
      skipped: 0,
      readability: [],
    }
    await askFn({ data: { message: 'Hello', scope: 'site', history: [] } })
    expect(hoisted.saved).toEqual([])
  })

  it('starts from the colours of a logo or a screenshot alone', async () => {
    await directionsFn({ data: { palette: ['#7a1f35'] } })
    expect(hoisted.directionsInput).toMatchObject({ site: null, words: null, palette: ['#7a1f35'] })
  })

  it('refuses a website it cannot read, and passes one it can', async () => {
    hoisted.site = { ok: false, reason: 'unreachable' }
    expect(await directionsFn({ data: { site: 'example.invalid' } })).toMatchObject({
      ok: false,
      code: 'SITE_UNREADABLE',
      message: 'That website could not be read. Check the address, or describe your brand instead.',
    })
    hoisted.site = { ok: false, reason: 'blocked' }
    expect(await directionsFn({ data: { site: 'example.com' } })).toMatchObject({
      message: 'That website blocks automated visits. Start from a screenshot of it instead.',
    })
    expect(hoisted.directionsInput).toBeNull()

    expect(hoisted.imported).toEqual([])

    hoisted.site = { ok: true, signals: { domain: 'example.com', title: 'Example' } }
    await directionsFn({ data: { site: 'example.com' } })
    // The site's files are stored for the looks to place.
    expect(hoisted.imported).toEqual([{ domain: 'example.com', title: 'Example' }])
    expect(hoisted.directionsInput).toMatchObject({
      site: { domain: 'example.com' },
      words: null,
      assets: { wordmark: { key: 'header-logos/site-a.svg' } },
    })
  })

  it('takes the website’s logo when the workspace has none, for someone who may change settings', async () => {
    hoisted.site = { ok: true, signals: { domain: 'example.com', title: 'Example' } }
    hoisted.branding = { domain: 'example.com', logoKey: 'logos/site.png', quality: 'good' }
    expect(await directionsFn({ data: { site: 'example.com' } })).toMatchObject({
      ok: true,
      logoAdopted: true,
    })
    expect(hoisted.savedLogos).toEqual(['logos/site.png'])

    hoisted.savedLogos = []
    hoisted.logoKey = 'logos/ours.png'
    expect(await directionsFn({ data: { site: 'example.com' } })).toMatchObject({
      logoAdopted: false,
    })
    hoisted.logoKey = null
    requireAuth.mockResolvedValue({
      principal: { id: 'principal_1' },
      permissions: ['settings.branding'],
    })
    expect(await directionsFn({ data: { site: 'example.com' } })).toMatchObject({
      logoAdopted: false,
    })
    requireAuth.mockResolvedValue({
      principal: { id: 'principal_1' },
      permissions: ['settings.branding', 'settings.manage'],
    })
    hoisted.branding = { domain: 'example.com', logoKey: 'logos/favicon.ico', quality: 'weak' }
    expect(await directionsFn({ data: { site: 'example.com' } })).toMatchObject({
      logoAdopted: false,
    })
    expect(hoisted.savedLogos).toEqual([])
  })
})
