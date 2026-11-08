/**
 * The loop's orchestration with the model and the preview mocked: it acts,
 * checks what was drawn, corrects what the check found, stops when done and
 * met or when the steps or the time run out, merges every step's changes
 * into one undoable list, and says plainly what it could not do. Also the
 * router and the tool schemas the registry generates.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../../schema'
import type { OpWorld } from '../../design-ops'
import { runEditLoop, trailOf, type LoopDeps, type StepReply, type StepRequest } from '../loop'
import { routeRequest } from '../router'
import { staticReadings } from '../static-reading'
import { agentStepSchema, type AgentStepAnswer } from '../step-schema'
import { applyStep } from '../style-ops'
import { STYLE_REGISTRY, registryText, type StyleRegistry } from '../style-registry'

const R = STYLE_REGISTRY

function start(): PortalDesign {
  const d = defaultDesign()
  d.brand.light.accent = '#4f46e5'
  return portalDesign.parse(d)
}

const world: OpWorld = {
  gates: {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: true,
  },
  places: { boards: [], roadmaps: [], categories: [] },
  untrusted: { blockTypes: [], links: new Set(), checkCss: () => null },
}

const answer = (a: Partial<AgentStepAnswer>): AgentStepAnswer => ({
  plan: '',
  ops: [],
  styles: [],
  checks: [],
  read: [],
  look: false,
  read_website: '',
  match_website: '',
  done: false,
  reply: '',
  ...a,
})

/** A model that answers each step in turn, applied as the server applies it. */
function scripted(steps: AgentStepAnswer[], design: { current: PortalDesign }) {
  const asked: StepRequest[] = []
  const step = vi.fn(async (request: StepRequest): Promise<StepReply> => {
    asked.push(request)
    const a = steps[request.step]
    if (!a) return { ok: false, code: 'AI_FAILED', message: 'no answer' }
    const out = applyStep(
      design.current,
      world,
      R,
      a.ops.map(({ op, target, key, value }) => ({ op, target, key, value })),
      a.styles
    )
    design.current = out.design
    const { design: next, ...outcome } = out
    return { ok: true, answer: a, outcome, design: next }
  })
  return { step, asked }
}

/** The preview read from the design, as the eval reads it. */
const reader = (design: { current: PortalDesign }, original: PortalDesign): LoopDeps['read'] =>
  vi.fn(async (targets, which) =>
    staticReadings(which === 'before' ? original : design.current, R, targets)
  )

const hoverStyle = (value: string) => ({
  element: 'button' as const,
  state: 'hover' as const,
  block: '',
  property: 'background' as const,
  value,
  says: 'buttons darker on hover',
})
const darkerCheck = {
  element: 'button' as const,
  state: 'hover' as const,
  block: '',
  target: '',
  property: 'background' as const,
  expect: 'darker' as const,
  value: '',
}

describe('the edit loop', () => {
  it('finishes in one step when the first answer is done and its checks are met', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Darken buttons on hover',
          styles: [hoverStyle('darker')],
          checks: [darkerCheck],
          done: true,
          reply: 'Buttons now darken on hover.',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [{ element: 'button', state: 'base', block: '' }],
      deps: { step, read: reader(design, original) },
    })
    expect(step).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('done')
    expect(result.reply).toBe('Buttons now darken on hover.')
    expect(result.applied.map((c) => c.path)).toEqual(['style'])
    // The check and the readability check it brings, both met.
    expect(result.steps[0]!.checks.map((c) => c.ok)).toEqual([true, true])
  })

  it('checks an override where it went: its own check, and its text readable for it', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Make the hero’s call to action black',
          ops: [
            {
              op: 'override',
              target: 'part:hero.home.cta',
              key: 'button.base.background',
              value: 'black',
              says: 'the call to action black',
            },
          ],
          checks: [
            {
              element: 'button',
              state: 'base',
              block: '',
              target: 'part:hero.home.cta',
              property: 'background',
              expect: 'is',
              value: '#000000',
            },
          ],
          done: true,
          reply: 'The call to action is black.',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('done')
    expect(result.steps[0]!.checks.map((c) => [c.ok, c.check.target, c.check.expect])).toEqual([
      [true, 'part:hero.home.cta', 'is'],
      [true, 'part:hero.home.cta', 'readable'],
    ])
  })

  it('does not measure a check on what was set for phones only, as it reads the page at full width', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Taller buttons on phones',
          ops: [
            {
              op: 'override',
              target: 'everywhere',
              key: 'phone.button.base.height',
              value: '48',
              says: 'buttons 48px tall on phones',
            },
          ],
          checks: [
            {
              element: 'button',
              state: 'base',
              block: '',
              target: '',
              property: 'height',
              expect: 'is',
              value: '48px',
            },
          ],
          done: true,
          reply: 'Buttons are 48px tall on phones.',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(step).toHaveBeenCalledTimes(1)
    expect(result.stopped).toBe('done')
    expect(result.steps[0]!.checks.map((c) => c.ok)).toEqual([null])
  })

  it('corrects what the check found, and holds the correction to the first step’s checks', async () => {
    const original = start()
    const design = { current: original }
    const { step, asked } = scripted(
      [
        // A hover lighter than at rest: the check fails.
        answer({
          plan: 'Change the hover',
          styles: [hoverStyle('#a5b4fc')],
          checks: [darkerCheck],
          done: true,
          reply: 'Done.',
        }),
        answer({
          plan: 'Make the hover darker instead',
          styles: [hoverStyle('#3730a3')],
          done: true,
          reply: 'Buttons darken on hover.',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(step).toHaveBeenCalledTimes(2)
    // The second step was told what the check saw.
    expect(asked[1]!.turns[0]!.checks.some((c) => c.ok === false && /not darker/.test(c.saw))).toBe(
      true
    )
    expect(result.stopped).toBe('done')
    expect(result.unmet).toEqual([])
    // One field, once: from before the first step to after the last.
    expect(result.applied).toHaveLength(1)
    expect(result.applied[0]!.before).toBeNull()
    expect(JSON.stringify(result.applied[0]!.after)).toContain('#3730a3')
    expect(trailOf(result.steps)).toEqual([
      // Lighter: its text is moved until it reads (the token system does), but it is not darker.
      '1. Change the hover 1 change. Checked 1/2, 1 to correct.',
      '2. Make the hover darker instead 1 change. Checked 2/2.',
    ])
  })

  it('stops at the step budget and says plainly what it could not do', async () => {
    const original = start()
    const design = { current: original }
    const wrong = answer({
      plan: 'Try',
      styles: [hoverStyle('#c7d2fe')],
      checks: [darkerCheck],
      done: true,
      reply: 'Done.',
    })
    const { step } = scripted([wrong, wrong, wrong], design)
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
      budget: { steps: 3, ms: 60_000 },
    })
    if (!result.ok) throw new Error(result.message)
    expect(step).toHaveBeenCalledTimes(3)
    expect(result.stopped).toBe('steps')
    // One sentence; what did not come out as asked is under Show changes.
    expect(result.reply).toBe('I changed main buttons on hover: background periwinkle.')
    expect(result.notes).toContain('Some of it did not come out as asked, so ask again to finish.')
  })

  it('starts no step the time budget cannot fit', async () => {
    const original = start()
    const design = { current: original }
    let clock = 0
    const wrong = answer({
      plan: 'Try',
      styles: [hoverStyle('#c7d2fe')],
      checks: [darkerCheck],
      done: true,
    })
    const { step } = scripted([wrong, wrong, wrong, wrong], design)
    const slow: LoopDeps['step'] = async (request) => {
      clock += 9_000
      return step(request)
    }
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step: slow, read: reader(design, original), now: () => clock },
      budget: { steps: 4, ms: 20_000 },
    })
    if (!result.ok) throw new Error(result.message)
    // 9s, 18s; a third would end at 27s.
    expect(step).toHaveBeenCalledTimes(2)
    expect(result.stopped).toBe('time')
    expect(result.reply).toMatch(/, but I stopped before checking everything\.$/)
  })

  it('reads the design before the request for a check that compares with it', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Rounder cards',
          styles: [
            {
              element: 'postCard',
              state: 'base',
              block: '',
              property: 'radius',
              value: '20',
              says: '',
            },
          ],
          checks: [
            {
              element: 'postCard',
              state: 'base',
              block: '',
              target: '',
              property: 'radius',
              expect: 'more',
              value: 'before',
            },
          ],
          done: true,
          reply: 'Rounder cards.',
        }),
      ],
      design
    )
    const read = reader(design, original)
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read },
    })
    if (!result.ok) throw new Error(result.message)
    expect(read).toHaveBeenCalledWith([{ element: 'postCard', state: 'base', block: '' }], 'before')
    expect(result.steps[0]!.checks[0]!.ok).toBe(true)
  })

  it('reports a refusal and changes nothing when the first step cannot be applied', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'x',
          styles: [{ ...hoverStyle('#000'), element: 'headline' }],
          done: true,
          reply: 'Done!',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.applied).toEqual([])
    expect(result.reply).toMatch(/^Nothing changed: page headlines have no hover state/)
  })

  it('passes a failed first step on as the answer', async () => {
    const original = start()
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: {
        step: async () => ({ ok: false, code: 'AI_FAILED', message: 'Try rephrasing.' }),
        read: async () => ({}),
      },
    })
    expect(result).toEqual({ ok: false, code: 'AI_FAILED', message: 'Try rephrasing.' })
  })

  it('keeps what an earlier step applied when a later step throws, with its Undo', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Darken buttons on hover',
          styles: [hoverStyle('#c7d2fe')],
          checks: [darkerCheck],
          done: false,
        }),
      ],
      design
    )
    const flaky: LoopDeps['step'] = async (request) => {
      if (request.step > 0) throw new Error('network')
      return step(request)
    }
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step: flaky, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('failed')
    // The first step's change is the request's one Undo, and the reply says it stopped.
    expect(result.applied.map((c) => c.path)).toEqual(['style'])
    expect(result.design).toEqual(design.current)
    expect(result.reply).toMatch(/^I changed .*, but I stopped before checking everything\.$/)
  })

  it('keeps what an earlier step applied when a later step is refused', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [answer({ plan: 'Try', styles: [hoverStyle('#c7d2fe')], checks: [darkerCheck] })],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('failed')
    expect(result.applied).toHaveLength(1)
  })

  it('throws as before when a step throws with nothing changed', async () => {
    const original = start()
    await expect(
      runEditLoop({
        registry: R,
        design: original,
        targets: [],
        deps: {
          step: async () => {
            throw new Error('network')
          },
          read: async () => ({}),
        },
      })
    ).rejects.toThrow('network')
  })

  it('says how far the changes reached beyond the page shown, in the same sentence', async () => {
    const original = start()
    const design = { current: original }
    const { step } = scripted(
      [
        answer({
          plan: 'Calm the hero',
          ops: [{ op: 'set', target: 'hero', key: 'look', value: 'tint', says: '' }],
          done: true,
          reply: 'The hero is calmer. It is a soft tint now.',
        }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
      pick: { scope: 'band', page: 'home' },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.reply).toBe('The hero is calmer, on every page.')
  })

  it('reports styles left outside the pick under Show changes, and to the next step', async () => {
    const original = start()
    const design = { current: original }
    const asked: StepRequest[] = []
    const step: LoopDeps['step'] = async (request) => {
      asked.push(request)
      const a =
        request.step === 0
          ? answer({
              plan: 'Cards',
              styles: [
                { ...hoverStyle('darker'), element: 'postCard', property: 'shadow', value: 'soft' },
              ],
            })
          : answer({ plan: 'Done', done: true })
      const out = applyStep(design.current, world, R, [], a.styles, {
        scope: 'band',
        reach: 'every',
        page: 'home',
      })
      design.current = out.design
      const { design: next, ...outcome } = out
      return { ok: true, answer: a, outcome, design: next }
    }
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
      pick: { scope: 'band', page: 'home' },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.applied).toEqual([])
    expect(result.reply).toBe('That is outside what was picked, so nothing changed.')
    expect(result.notes).toEqual([
      'Left alone, as it is outside what was picked: post cards on hover.',
    ])
    expect(asked[1]!.turns[0]!.refused).toEqual([
      { what: 'Post cards on hover', reason: 'outside what was picked: left alone' },
    ])
  })

  it('hands what a step asked to read to the next one', async () => {
    const original = start()
    const design = { current: original }
    const { step, asked } = scripted(
      [
        answer({
          plan: 'Look at the buttons first',
          read: [{ element: 'button', state: 'base', block: '' }],
        }),
        answer({ plan: 'Done', done: true, reply: 'They are already so.' }),
      ],
      design
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
    })
    expect(asked[1]!.readings[0]!.target).toBe('Main buttons')
    expect(asked[1]!.readings[0]!.values.background).toBeDefined()
    expect(result.ok && result.reply).toBe('They are already so.')
  })
})

describe('the router', () => {
  const route = (message: string, images = 0) => routeRequest(R, { message, images })
  it('takes states, looks by feel, pictures, contrast and element styles through the loop', () => {
    expect(route('Make the buttons darker on hover')).toMatchObject({
      mode: 'loop',
      targets: [
        { element: 'button', state: 'base', block: '' },
        { element: 'button', state: 'hover', block: '' },
      ],
    })
    expect(route('Make it feel more like Tidewell: dark, tight, subtle borders').mode).toBe('loop')
    expect(route('Match the button style in this screenshot', 1).mode).toBe('loop')
    expect(route('Is the text readable enough? Fix the contrast').mode).toBe('loop')
    expect(route('Give the cards a subtle shadow').mode).toBe('loop')
    expect(route('Give only the roadmap block a border').mode).toBe('loop')
    expect(route('Make the current page in the menu bold and in our brand colour').mode).toBe(
      'loop'
    )
  })
  it('keeps plain changes on one call', () => {
    for (const message of [
      'Move help search to the top',
      'Rename Changelog to What’s new',
      'Make the hero shorter',
      'Show 5 posts in top posts',
      'Use a dark green, #0f766e, as our brand colour',
      'Rounder corners everywhere',
      'Mark the current page in the menu with a filled pill',
      'Make the page background a warm cream',
      'Add a soft glow of our brand colour at the top of the page',
      'Make the second half of the headline lighter',
    ])
      expect(route(message).mode, message).toBe('single')
  })
})

describe('the tool schemas', () => {
  it('names only the registry’s elements, states and properties', () => {
    const schema = agentStepSchema(R)
    const ok = answer({ styles: [hoverStyle('darker')], checks: [darkerCheck] })
    expect(schema.safeParse(ok).success).toBe(true)
    expect(
      schema.safeParse({ ...ok, styles: [{ ...hoverStyle('x'), element: 'cape' }] }).success
    ).toBe(false)
  })

  it('follows a different registry, as the token system’s will be', () => {
    const tokens: StyleRegistry = {
      ...R,
      source: 'tokens',
      elements: [{ ...R.elements[1]!, id: 'primary-action' }],
    }
    const schema = agentStepSchema(tokens)
    const styles = [{ ...hoverStyle('darker'), element: 'primary-action' }]
    expect(schema.safeParse(answer({ styles: styles as never })).success).toBe(true)
    expect(schema.safeParse(answer({ styles: [hoverStyle('darker')] })).success).toBe(false)
    expect(registryText(tokens)).toContain('- primary-action (')
  })

  it('narrows the context to the elements asked for', () => {
    const text = registryText(R, ['postCard'])
    expect(text).toContain('- postCard (')
    expect(text).not.toContain('- button (')
    expect(text).toContain('- shadow:')
    expect(text).not.toContain('- font-size:')
  })
})

describe('the edit loop, stopped', () => {
  it('takes no step after Stop, keeping what the steps before applied', async () => {
    const original = start()
    const design = { current: original }
    const stop = new AbortController()
    const { step } = scripted(
      [
        answer({ plan: 'Darken buttons on hover', styles: [hoverStyle('darker')], done: false }),
        answer({ plan: 'Correct', styles: [hoverStyle('#000000')], done: true }),
      ],
      design
    )
    const read = vi.fn(
      async (targets: Parameters<LoopDeps['read']>[0], which: 'before' | 'now') => {
        // Stop lands while the first step's result is checked.
        if (which === 'now') stop.abort()
        return staticReadings(which === 'before' ? original : design.current, R, targets)
      }
    )
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read },
      signal: stop.signal,
    })
    expect(step).toHaveBeenCalledTimes(1)
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('stopped')
    expect(result.applied.map((c) => c.path)).toEqual(['style'])
  })

  it('keeps what applied when a step is cut off by Stop', async () => {
    const original = start()
    const design = { current: original }
    const stop = new AbortController()
    const { step: first } = scripted(
      [answer({ plan: 'Darken buttons on hover', styles: [hoverStyle('darker')] })],
      design
    )
    const step = vi.fn(async (request: StepRequest): Promise<StepReply> => {
      if (request.step === 0) return first(request)
      stop.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader(design, original) },
      signal: stop.signal,
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('stopped')
    expect(result.applied.map((c) => c.path)).toEqual(['style'])
  })

  it('says it stopped when Stop came before any step', async () => {
    const stop = new AbortController()
    stop.abort()
    const original = start()
    const { step } = scripted([answer({ done: true })], { current: original })
    const result = await runEditLoop({
      registry: R,
      design: original,
      targets: [],
      deps: { step, read: reader({ current: original }, original) },
      signal: stop.signal,
    })
    expect(step).not.toHaveBeenCalled()
    if (!result.ok) throw new Error(result.message)
    expect(result.stopped).toBe('stopped')
    expect(result.applied).toEqual([])
  })
})
