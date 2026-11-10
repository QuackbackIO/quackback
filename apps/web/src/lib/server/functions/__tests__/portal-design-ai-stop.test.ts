/**
 * The builder's Stop ends an Ask AI request on the server: the request's
 * signal reaches the model call, and a request stopped while the model
 * answered saves nothing to the draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  controller: new AbortController(),
  ask: vi.fn(),
  step: vi.fn(),
  save: vi.fn(),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (value: unknown) => unknown }
    const builder = {
      validator(value: typeof schema) {
        schema = value
        return builder
      },
      handler(fn: (args: { data: unknown }) => unknown) {
        return async (args: { data: unknown }) => fn({ data: schema.parse(args.data) })
      },
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => ({ signal: state.controller.signal }),
}))
vi.mock('../auth-helpers', () => ({ requireAuth: async () => ({ principal: { id: 'p' } }) }))
vi.mock('@/lib/server/domains/design/ai/design-ai', () => ({
  askDesignAi: state.ask,
  allowanceRefusal: async () => null,
  designAiModel: () => 'model',
}))
vi.mock('@/lib/server/domains/design/ai/design-agent', () => ({ agentStep: state.step }))
vi.mock('@/lib/server/domains/design/design.actions', () => ({
  readDraftForChange: async () => ({ design: {}, revision: 'r1' }),
  saveDesignDraft: state.save,
}))
vi.mock('@/lib/server/domains/design/design-author', () => ({ designAuthor: async () => ({}) }))
vi.mock('@/lib/server/domains/design/design-allowances', () => ({
  designAllowances: async () => ({ gates: {} }),
}))
vi.mock('@/lib/server/domains/design/designer-places', () => ({
  listDesignerPlaces: async () => ({ boards: [], roadmaps: [], categories: [] }),
}))
vi.mock('@/lib/server/domains/design/site/website-reading', () => ({
  storedSiteImages: async () => new Set(),
}))

const { askPortalDesignAiFn, designAgentStepFn } = await import('../portal-design-ai')

const applied = [{ path: 'shape.corners', before: 'rounded', after: 'sharp' }]

beforeEach(() => {
  state.controller = new AbortController()
  state.ask.mockReset()
  state.step.mockReset()
  state.save.mockReset()
  state.save.mockResolvedValue({ ok: true, report: {}, revision: 'r2' })
})

describe('Stop on the server', () => {
  it('hands the request’s signal to the model call and saves as usual when not stopped', async () => {
    state.ask.mockResolvedValue({ ok: true, applied, design: {}, reply: 'Done.' })
    const result = await askPortalDesignAiFn({
      data: { message: 'Square corners', scope: 'site', history: [] },
    })
    expect(state.ask.mock.calls[0]![0].signal).toBe(state.controller.signal)
    expect(state.save).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: true, revision: 'r2' })
  })

  it('saves nothing when the request was stopped while the model answered', async () => {
    state.ask.mockImplementation(async () => {
      state.controller.abort()
      return { ok: true, applied, design: {}, reply: 'Done.' }
    })
    const result = await askPortalDesignAiFn({
      data: { message: 'Square corners', scope: 'site', history: [] },
    })
    expect(state.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, code: 'STOPPED' })
  })

  it('takes a model call cut off by Stop as stopped, not failed', async () => {
    state.ask.mockImplementation(async () => {
      state.controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const result = await askPortalDesignAiFn({
      data: { message: 'Square corners', scope: 'site', history: [] },
    })
    expect(result).toMatchObject({ ok: false, code: 'STOPPED' })
  })

  it('saves no loop step stopped while the model answered', async () => {
    state.step.mockImplementation(async (input: { signal: AbortSignal }) => {
      expect(input.signal).toBe(state.controller.signal)
      state.controller.abort()
      return { ok: true, answer: {}, outcome: { applied }, design: {} }
    })
    const result = await designAgentStepFn({
      data: {
        message: 'Darker on hover',
        scope: 'site',
        history: [],
        step: { step: 0, turns: [], readings: [], picture: null, last: false },
        maxSteps: 4,
      },
    })
    expect(state.save).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, code: 'STOPPED' })
  })
})
