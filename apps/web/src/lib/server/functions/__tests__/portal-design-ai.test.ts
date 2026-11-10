/**
 * Quackback AI in Appearance needs the branding permission. A request that
 * changes something saves the draft for the person who asked; one that
 * changes nothing leaves the draft alone. Screenshots sent to match the brand
 * start it: the first look, with the colours measured from them, lands in
 * the draft and the reply says what changed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({
  handlers: [] as Handler[],
  validators: [] as Array<{ safeParse: (data: unknown) => { success: boolean } }>,
  saved: [] as Array<{ design: unknown; author: unknown }>,
  answer: null as unknown,
  logoKey: null as string | null,
  directionsInput: null as unknown,
  look: null as unknown,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator: (schema: { safeParse: (data: unknown) => { success: boolean } }) => {
        hoisted.validators.push(schema)
        return chain
      },
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
  readDraftForChange: async () => ({ design: defaultDesign(), revision: 'rev1' }),
  saveDesignDraft: async (design: unknown, author: unknown) => {
    hoisted.saved.push({ design, author })
    return { ok: true, report: { adjustments: [], errors: [] } }
  },
}))
vi.mock('@/lib/server/domains/design/ai/design-ai', () => ({
  designAiModel: () => 'test-model',
  askDesignAi: async () => hoisted.answer,
}))
vi.mock('@/lib/server/domains/design/ai/design-directions', () => ({
  designDirections: async (input: unknown) => {
    hoisted.directionsInput = input
    return { ok: true, looks: hoisted.look ? [hoisted.look] : [] }
  },
}))
// What the workspace allows Quackback AI to bring in.
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: async () => ({
    name: 'Example',
    featureFlags: { feedback: true },
    settings: { logoKey: hoisted.logoKey },
  }),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({ assertTierFeature: async () => {} }))
vi.mock('@/lib/server/config', () => ({ config: { portalDesignAiCss: false } }))

await import('../portal-design-ai')
const [statusFn, askFn, shotsFn] = hoisted.handlers

beforeEach(() => {
  hoisted.saved = []
  hoisted.directionsInput = null
  hoisted.look = null
  requireAuth.mockReset()
  requireAuth.mockResolvedValue({
    principal: { id: 'principal_1' },
    permissions: ['settings.branding', 'settings.manage'],
  })
  hoisted.logoKey = null
})

describe('the chat request', () => {
  const jpeg = (size = 8) => `data:image/jpeg;base64,${'A'.repeat(size)}`
  const request = (images: unknown) => ({
    message: 'Match these',
    scope: 'site',
    history: [],
    images,
  })
  const accepts = (images: unknown, message = 'Match these') =>
    hoisted.validators[0]!.safeParse({ ...request(images), message }).success

  it('takes up to four images, each with its colours', () => {
    const one = { palette: ['#112233'], image: jpeg() }
    expect(accepts(undefined)).toBe(true)
    expect(accepts([one, one, one, one])).toBe(true)
    expect(accepts([{ palette: ['#112233'] }])).toBe(true)
  })

  it('takes images with nothing else said', () => {
    const one = { palette: ['#112233'], image: jpeg() }
    expect(accepts([one], '')).toBe(true)
    expect(accepts(undefined, '')).toBe(false)
  })

  it('refuses a fifth image', () => {
    const one = { palette: ['#112233'], image: jpeg() }
    expect(accepts([one, one, one, one, one])).toBe(false)
  })

  it('refuses an image that is too large, not a JPEG or has too many colours', () => {
    expect(accepts([{ palette: [], image: jpeg(700_001) }])).toBe(false)
    expect(accepts([{ palette: [], image: 'data:image/png;base64,AAAA' }])).toBe(false)
    expect(accepts([{ palette: Array(7).fill('#112233') }])).toBe(false)
  })
})

describe('portal design AI functions', () => {
  it('each needs the branding permission', async () => {
    requireAuth.mockRejectedValue(new Error('forbidden'))
    await expect(statusFn({ data: {} })).rejects.toThrow('forbidden')
    await expect(askFn({ data: { message: 'x', scope: 'site', history: [] } })).rejects.toThrow()
    await expect(shotsFn({ data: { images: ['data:image/jpeg;base64,AAAA'] } })).rejects.toThrow()
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
})
