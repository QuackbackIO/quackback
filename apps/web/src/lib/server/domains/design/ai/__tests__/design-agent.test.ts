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

describe('a step keeps to what was picked and how far the chip says it reaches', () => {
  const hoverDarker = {
    plan: 'Darken the main button on hover',
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
    reply: 'The main button is darker on hover.',
  }
  const calmer = {
    ...hoverDarker,
    plan: 'Calm the hero',
    ops: [{ op: 'set', target: 'hero', key: 'look', value: 'tint', says: 'the hero to a tint' }],
    styles: [],
    reply: 'The hero is calmer.',
  }
  const overrides = (design: { overrides?: unknown }) =>
    (design.overrides ?? []) as Array<{
      target: { scope: string; part?: string; page?: string }
      style?: { hover?: { background?: unknown } }
    }>

  for (const message of [
    'Make the main button darker when hovered',
    // Read by no English pattern: the chip's reach holds it all the same.
    'Mach den Hauptbutton dunkler, wenn man darüber fährt',
  ])
    it(`with the hero picked, “${message}” changes the hero’s buttons, never every main button`, async () => {
      const reply = await step(hoverDarker, {
        message,
        scope: 'band',
        within: 'every',
        page: 'home',
      })
      if (!reply.ok) throw new Error(reply.message)
      // No site-wide style: the main buttons elsewhere are as they were.
      expect(reply.design.style?.button?.hover).toBeUndefined()
      expect(reply.design.tune).toEqual(fixtureDesign().tune)
      // The hero's own button holds it, as an override on that part.
      const cta = overrides(reply.design).find((o) => o.target.part === 'hero.home.cta')
      expect(cta?.style?.hover?.background).toMatch(/^#[0-9a-f]{6}$/)
      expect(
        overrides(reply.design).every(
          (o) => o.target.scope === 'part' && /^(hero|title)\./.test(o.target.part ?? '')
        )
      ).toBe(true)
    })

  it('with the hero picked for this page only, a hover style lands on this page’s hero alone', async () => {
    const reply = await step(hoverDarker, {
      message: 'Make the main button darker when hovered',
      scope: 'band',
      within: 'page',
      page: 'home',
    })
    if (!reply.ok) throw new Error(reply.message)
    expect(reply.design.style?.button?.hover).toBeUndefined()
    const parts = overrides(reply.design).map((o) => o.target.part)
    expect(parts).toEqual(['hero.home.cta'])
  })

  it('with the hero’s call to action picked, keeps a hover style to the reach the chip says', async () => {
    const element = { element: 'button' as const, part: 'hero.home.cta' }
    const one = await step(hoverDarker, {
      scope: 'band',
      element,
      within: 'one',
      page: 'home',
    })
    if (!one.ok) throw new Error(one.message)
    expect(one.design.style?.button?.hover).toBeUndefined()
    expect(overrides(one.design).map((o) => o.target.part)).toEqual(['hero.home.cta'])
    const page = await step(hoverDarker, { scope: 'band', element, within: 'page', page: 'home' })
    if (!page.ok) throw new Error(page.message)
    expect(page.design.style?.button?.hover).toBeUndefined()
    expect(overrides(page.design).map((o) => o.target)).toEqual([
      { scope: 'page', page: 'home', element: 'button' },
    ])
    // Every main button: the panel's own default for an element, said on the chip.
    const every = await step(hoverDarker, { scope: 'band', element, within: 'every', page: 'home' })
    if (!every.ok) throw new Error(every.message)
    expect(every.design.style?.button?.hover?.background).toMatch(/^#[0-9a-f]{6}$/)
  })

  for (const message of ['Make this calmer', 'Mach das ruhiger'])
    it(`with the hero picked for this page only, “${message}” changes no other page`, async () => {
      const before = fixtureDesign()
      const reply = await step(calmer, { message, scope: 'band', within: 'page', page: 'home' })
      if (!reply.ok) throw new Error(reply.message)
      // The hero's look is one for every page, so it is left, and said so.
      expect(reply.design.layout).toEqual(before.layout)
      expect(reply.outcome.applied).toEqual([])
      expect(reply.outcome.outOfScope.length).toBeGreaterThan(0)
    })

  it('with the hero picked for every page, the same request changes the hero everywhere', async () => {
    const reply = await step(calmer, {
      message: 'Make this calmer',
      scope: 'band',
      within: 'every',
      page: 'home',
    })
    if (!reply.ok) throw new Error(reply.message)
    expect(reply.design.layout.hero).toBe('tint')
  })

  it('reports a style outside the pick as left alone, never drops it silently', async () => {
    const reply = await step(
      {
        ...hoverDarker,
        styles: [
          { ...hoverDarker.styles[0]!, element: 'postCard', property: 'shadow', value: 'soft' },
        ],
      },
      { message: 'Add a shadow to the cards', scope: 'band', within: 'every', page: 'home' }
    )
    if (!reply.ok) throw new Error(reply.message)
    expect(reply.design.style?.postCard).toBeUndefined()
    expect(reply.outcome.outOfScope).toEqual(['Post cards on hover'])
  })

  it('never restyles the whole site from a part-scoped request, whatever the model answers', async () => {
    const answer = { ...hoverDarker, match_website: 'https://stripe.com' }
    const scoped = await step(answer, {
      message: 'Make this button feel like stripe.com',
      scope: 'band',
      within: 'every',
      page: 'home',
    })
    if (!scoped.ok) throw new Error(scoped.message)
    expect(scoped.answer.match_website).toBe('')
    // Asked about the whole site, the same answer keeps it.
    const site = await step(answer, { message: 'Make the portal feel like stripe.com' })
    if (!site.ok) throw new Error(site.message)
    expect(site.answer.match_website).toBe('https://stripe.com')
  })

  it('tells the model how far it may reach', async () => {
    await step(calmer, { message: 'Make this calmer', scope: 'band', within: 'page', page: 'home' })
    const system = model.calls[0]!.systemPrompts.join('\n')
    expect(system).toContain('only on the Home page')
  })
})
