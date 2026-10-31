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
  directionsInput: null as unknown,
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
vi.mock('@/lib/server/domains/design/ai/site-signals', () => ({
  readSiteSignals: async () => hoisted.site,
}))

await import('../portal-design-ai')
const [statusFn, askFn, directionsFn] = hoisted.handlers

beforeEach(() => {
  hoisted.saved = []
  hoisted.directionsInput = null
  requireAuth.mockReset()
  requireAuth.mockResolvedValue({ principal: { id: 'principal_1' } })
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
    hoisted.site = null
    expect(await directionsFn({ data: { site: 'example.invalid' } })).toMatchObject({
      ok: false,
      code: 'SITE_UNREADABLE',
    })
    expect(hoisted.directionsInput).toBeNull()

    hoisted.site = { domain: 'example.com', title: 'Example', description: null, colour: null }
    await directionsFn({ data: { site: 'example.com' } })
    expect(hoisted.directionsInput).toMatchObject({ site: { domain: 'example.com' }, words: null })
  })
})
