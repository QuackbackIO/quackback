/**
 * The edit loop's website tools: the model reads a site (its facts and a
 * capture it sees in the next step), then matches it, and the loop calls
 * each once a site whatever the model asks; the reading's schema and the
 * example the model is shown agree; a refusal is a value it can explain.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '../../schema'
import { runEditLoop, type LoopDeps, type StepReply, type StepRequest } from '../loop'
import { agentStepSchema, type AgentStepAnswer } from '../step-schema'
import { STYLE_REGISTRY } from '../style-registry'
import {
  WEBSITE_READING_EXAMPLE,
  WEBSITE_TOOLS_TEXT,
  hostKey,
  readingSummary,
  websiteReadingSchema,
  type WebsiteReading,
} from '../website-tool'

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

/** A model on the server, which reads the draft as it is now (a match saves it). */
function model(steps: AgentStepAnswer[], draft: PortalDesign | (() => PortalDesign)) {
  const design = () => (typeof draft === 'function' ? draft() : draft)
  const asked: StepRequest[] = []
  const step = vi.fn(async (request: StepRequest): Promise<StepReply> => {
    asked.push(request)
    const a = steps[request.step]
    if (!a) return { ok: false, code: 'AI_FAILED', message: 'no answer' }
    return {
      ok: true,
      answer: a,
      outcome: { applied: [], done: [], refused: [] } as never,
      design: design(),
    }
  })
  return { step, asked }
}

const reading: WebsiteReading = WEBSITE_READING_EXAMPLE
const capture = 'data:image/jpeg;base64,AAAA'

describe('read_website and match_website in the loop', () => {
  it('reads a site, shows its capture next step, then matches it and says so', async () => {
    const original = portalDesign.parse(defaultDesign())
    const matchedDesign = portalDesign.parse({ ...defaultDesign(), mode: 'dark' })
    let draft = original
    const { step, asked } = model(
      [
        answer({ plan: 'Read the site', read_website: 'https://www.acme.test/' }),
        answer({ plan: 'Match it', match_website: 'acme.test' }),
        answer({ plan: 'Nothing more', done: true, reply: 'Kept the buttons square.' }),
      ],
      () => draft
    )
    const readWebsite = vi.fn(async () => ({ reading, capture }))
    const matchWebsite = vi.fn(async () => {
      draft = matchedDesign
      return {
        match: {
          ok: true,
          host: 'acme.test',
          reply: 'I matched your brand from acme.test.',
          changed: ['mode'],
          notes: [],
        },
        design: matchedDesign,
        applied: [{ path: 'mode', before: 'light', after: 'dark' }] as never,
      }
    })
    const progress = vi.fn()
    const result = await runEditLoop({
      registry: STYLE_REGISTRY,
      design: original,
      targets: [],
      deps: {
        step,
        read: vi.fn(async () => ({})),
        readWebsite,
        matchWebsite,
        progress,
      } as LoopDeps,
      budget: { steps: 4, ms: 60_000 },
    })
    expect(readWebsite).toHaveBeenCalledWith('https://www.acme.test/')
    expect(matchWebsite).toHaveBeenCalledWith('acme.test')
    expect(progress).toHaveBeenCalledWith('Reading acme.test')
    expect(progress).toHaveBeenCalledWith('Matching acme.test')
    // The reading and the capture go to the next step; the capture only once.
    expect(asked[1]!.website?.[0]).toContain('Website read (acme.test)')
    expect(asked[1]!.capture).toBe(capture)
    expect(asked[2]!.capture ?? null).toBeNull()
    expect(asked[2]!.website?.[1]).toContain('Website matched (acme.test)')
    expect(result.ok && result.design.mode).toBe('dark')
    // One sentence: the match; what the steps after it added is under Show changes.
    expect(result.ok && result.reply).toBe('I matched your brand from acme.test.')
  })

  it('never matches a whole site for a request about one part, and borrows by reading instead', async () => {
    // A request about one part is run without match_website: the builder passes it only for
    // the whole site, so "make this button feel like acme.test" cannot restyle the site.
    const original = portalDesign.parse(defaultDesign())
    const { step, asked } = model(
      [
        answer({ plan: 'Match it', match_website: 'acme.test' }),
        answer({ plan: 'Read it', read_website: 'acme.test' }),
        answer({ plan: 'Done', done: true, reply: 'The button is like acme.test’s.' }),
      ],
      original
    )
    const readWebsite = vi.fn(async () => ({ reading, capture: null }))
    const result = await runEditLoop({
      registry: STYLE_REGISTRY,
      design: original,
      targets: [],
      deps: { step, read: vi.fn(async () => ({})), readWebsite } as LoopDeps,
      budget: { steps: 4, ms: 60_000 },
      pick: { scope: 'band', page: 'home' },
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.design).toEqual(original)
    // The model is told why, so it reads the site and sets the part itself.
    expect(asked[1]!.website?.[0]).toMatch(/match_website is not offered/)
    expect(readWebsite).toHaveBeenCalledWith('acme.test')
  })

  it('reads and matches a site once, however often the model asks', async () => {
    const original = portalDesign.parse(defaultDesign())
    const { step, asked } = model(
      [
        answer({ read_website: 'acme.test' }),
        answer({ read_website: 'www.acme.test', match_website: 'acme.test' }),
        answer({ match_website: 'https://acme.test', done: true }),
        answer({ done: true }),
      ],
      original
    )
    const readWebsite = vi.fn(async () => ({ reading, capture: null }))
    const matchWebsite = vi.fn(async () => ({
      match: {
        ok: false,
        host: 'acme.test',
        reply: 'Captures are used up.',
        changed: [],
        notes: [],
      },
      design: null,
      applied: [],
    }))
    await runEditLoop({
      registry: STYLE_REGISTRY,
      design: original,
      targets: [],
      deps: { step, read: vi.fn(async () => ({})), readWebsite, matchWebsite } as LoopDeps,
      budget: { steps: 4, ms: 60_000 },
    })
    expect(readWebsite).toHaveBeenCalledTimes(1)
    expect(matchWebsite).toHaveBeenCalledTimes(1)
    expect(asked[2]!.website).toContain('acme.test is already read; use the result above.')
  })

  it('keeps the tools’ own time out of the steps’ budget', async () => {
    let clock = 0
    const original = portalDesign.parse(defaultDesign())
    const { step } = model(
      [answer({ read_website: 'acme.test' }), answer({ done: true, reply: 'Done.' })],
      original
    )
    const readWebsite = vi.fn(async () => {
      clock += 50_000
      return { reading, capture: null }
    })
    const result = await runEditLoop({
      registry: STYLE_REGISTRY,
      design: original,
      targets: [],
      deps: { step, read: vi.fn(async () => ({})), readWebsite, now: () => clock } as LoopDeps,
      budget: { steps: 4, ms: 24_000 },
    })
    expect(step).toHaveBeenCalledTimes(2)
    expect(result.ok && result.stopped).toBe('done')
  })
})

describe('Stop while a website tool works', () => {
  it('uses nothing a tool brought back after Stop: no check is read, no step follows', async () => {
    const original = portalDesign.parse(defaultDesign())
    const controller = new AbortController()
    const { step } = model(
      [
        answer({
          read_website: 'acme.test',
          checks: [
            {
              element: 'button',
              state: 'base',
              block: '',
              target: '',
              property: 'background',
              expect: 'changed',
              value: '',
            },
          ],
        }),
        answer({ done: true, reply: 'Done.' }),
      ],
      original
    )
    const read = vi.fn(async () => ({}))
    const readWebsite = vi.fn(async () => {
      // The person presses Stop while the site is read; the read still comes back.
      controller.abort()
      return { reading, capture }
    })
    const result = await runEditLoop({
      registry: STYLE_REGISTRY,
      design: original,
      targets: [],
      deps: { step, read, readWebsite } as LoopDeps,
      signal: controller.signal,
    })
    expect(result.ok && result.stopped).toBe('stopped')
    expect(step).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the reading', () => {
  it('the example the model is shown fits the schema and is in the tools’ text', () => {
    expect(websiteReadingSchema.parse(WEBSITE_READING_EXAMPLE)).toEqual(WEBSITE_READING_EXAMPLE)
    expect(WEBSITE_TOOLS_TEXT).toContain(JSON.stringify(WEBSITE_READING_EXAMPLE))
  })

  it('is part of every step answer', () => {
    const schema = agentStepSchema(STYLE_REGISTRY)
    expect(schema.safeParse(answer({ read_website: 'acme.test' })).success).toBe(true)
    const { read_website: _r, ...without } = answer({})
    expect(schema.safeParse(without).success).toBe(false)
  })

  it('a refusal is a value with a sentence to say', () => {
    const refused = websiteReadingSchema.parse({
      ok: false,
      host: 'acme.test',
      status: {
        source: 'none',
        fallback: 'limit',
        message: 'Captures are used up for today.',
        capturesLeftToday: null,
      },
      facts: null,
    })
    expect(readingSummary(refused)).toBe('Captures are used up for today.')
  })

  it('says what it found in a line', () => {
    expect(readingSummary(reading)).toBe(
      'Read acme.test: Acme Parcel, fonts Acme Display (drawn in the nearest bundled face) and Inter, 2 colours, a logo, a favicon.'
    )
  })

  it('keys a site by its host', () => {
    expect(hostKey('https://www.Acme.test/pricing')).toBe('acme.test')
    expect(hostKey('acme.test')).toBe('acme.test')
    expect(hostKey('')).toBeNull()
  })
})
