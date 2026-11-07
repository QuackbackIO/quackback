/**
 * One step of the edit loop on the server: the examples the model is shown
 * are valid answers that apply cleanly; a step's operations and styles land
 * through the design's checks, Ask AI's own style rules taking the style
 * check while other CSS keeps the workspace's; what the steps before did and
 * saw reaches the model; and an answer that never fits is a refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homeBlockTypes } from '@/lib/shared/design/home'
import { agentStepSchema } from '@/lib/shared/design/agent/step-schema'
import { applyStep } from '@/lib/shared/design/agent/style-ops'
import { STYLE_REGISTRY } from '@/lib/shared/design/agent/style-registry'
import { GATES, PLACES, fixtureDesign } from './edit-eval/cases'

const model = vi.hoisted(() => ({
  answer: null as unknown,
  misfits: 0,
  calls: [] as Array<{ systemPrompts: string[]; messages: Array<{ content: unknown }> }>,
}))

vi.mock('@/lib/server/config', () => ({ config: { openaiApiKey: 'key', openaiBaseUrl: 'url' } }))
vi.mock('@/lib/server/domains/ai/config', () => ({ isAiClientConfigured: () => true }))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: () => 'test-model' }))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  aiAllowanceNow: async () => ({ credits: 'available', resetsAt: null, trial: false }),
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'usage' }),
}))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (input: {
    systemPrompts: string[]
    messages: Array<{ content: unknown }>
  }) => {
    model.calls.push(input)
    if (model.misfits > 0) {
      model.misfits--
      throw Object.assign(new Error('did not fit'), { code: 'structured-output-validation-failed' })
    }
    return model.answer
  },
}))

const { AGENT_EXAMPLES, agentPrompt, agentStep } = await import('../design-agent')

const allows = () => ({
  blockTypes: homeBlockTypes(GATES),
  writesCss: false,
  checkCss: () => 'Quackback AI does not write CSS',
})

const world = {
  gates: GATES,
  places: PLACES,
  untrusted: { blockTypes: homeBlockTypes(GATES), links: new Set<string>(), checkCss: () => null },
}

const request = { step: 0, turns: [], readings: [], picture: null, last: false }

const step = (answer: unknown, extra: Partial<Parameters<typeof agentStep>[0]> = {}) => {
  model.answer = answer
  return agentStep({
    message: 'Make the buttons darker on hover',
    design: fixtureDesign(),
    scope: 'site',
    history: [],
    allows: allows(),
    places: PLACES,
    gates: GATES,
    request,
    maxSteps: 4,
    ...extra,
  })
}

beforeEach(() => {
  model.answer = null
  model.misfits = 0
  model.calls = []
})

describe('the loop’s examples', () => {
  for (const example of AGENT_EXAMPLES)
    it(`“${example.request}”${example.note ? ` (${example.note})` : ''} is a valid step that applies`, () => {
      expect(agentStepSchema(STYLE_REGISTRY).safeParse(example.answer).success).toBe(true)
      const out = applyStep(
        fixtureDesign(),
        world,
        STYLE_REGISTRY,
        example.answer.ops.map(({ op, target, key, value }) => ({
          op,
          ...(target ? { target } : {}),
          ...(key ? { key } : {}),
          ...(value ? { value } : {}),
        })),
        example.answer.styles
      )
      expect(out.refused).toEqual([])
      // A step that reads a website first changes nothing until it has the reading.
      if (example.answer.read_website) expect(out.applied).toEqual([])
      else expect(out.applied.length).toBeGreaterThan(0)
    })

  it('teaches the website tools, with an example reading that fits its schema', () => {
    const prompt = agentPrompt({
      blockTypes: homeBlockTypes(GATES),
      places: PLACES,
      registry: STYLE_REGISTRY,
    })
    expect(prompt).toContain('- read_website: a website')
    expect(prompt).toContain('Example reading: {')
  })

  it('teaches the registry’s elements and the operations', () => {
    const prompt = agentPrompt({
      blockTypes: homeBlockTypes(GATES),
      places: PLACES,
      registry: STYLE_REGISTRY,
    })
    expect(prompt).toContain('- button (primary buttons')
    expect(prompt).toContain('- menu: target a menu item')
    expect(prompt).toContain('darker 15%')
  })
})

describe('one step', () => {
  const hover = {
    plan: 'Darken buttons on hover',
    ops: [],
    styles: [
      {
        element: 'button',
        state: 'hover',
        block: '',
        property: 'background',
        value: 'darker',
        says: '',
      },
    ],
    checks: [],
    read: [],
    look: false,
    read_website: '',
    match_website: '',
    done: true,
    reply: 'Done.',
  }

  it('applies its styles as style tokens, with no CSS, whatever the plan allows of CSS', async () => {
    const reply = await step(hover)
    if (!reply.ok) throw new Error(reply.message)
    expect(reply.outcome.refused).toEqual([])
    expect(reply.design.style?.button?.hover?.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(reply.design.css ?? '').toBe('')
    expect(reply.outcome.applied[0]!.label).toMatch(/^Main buttons on hover: background darker/)
  })

  it('tells the model what the steps before did and saw', async () => {
    await step(hover, {
      request: {
        step: 1,
        last: true,
        picture: null,
        readings: [{ target: 'Buttons', values: { background: 'rgb(79, 70, 229)' } }],
        turns: [
          {
            step: 0,
            plan: 'Darken buttons on hover',
            did: ['Buttons on hover: background #4e45e4'],
            refused: [],
            checks: [
              {
                ok: false,
                saw: 'Buttons on hover: background #4e45e4 is only 1% darker than at rest',
              },
            ],
          },
        ],
      },
    })
    const text = model.calls[0]!.messages.at(-1)!.content as string
    expect(text).toContain('This is step 2 of at most 4. It is the last')
    expect(text).toContain('NOT MET: Buttons on hover: background #4e45e4 is only 1% darker')
    expect(text).toContain('Buttons: background rgb(79, 70, 229)')
  })

  it('asks once more for an answer that does not fit, then refuses', async () => {
    model.misfits = 1
    expect((await step(hover)).ok).toBe(true)
    model.misfits = 2
    expect(await step(hover)).toMatchObject({ ok: false, code: 'AI_FAILED' })
  })
})
