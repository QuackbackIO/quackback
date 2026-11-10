// @vitest-environment happy-dom
/**
 * The conversation's hook: a turn made elsewhere joins it, screenshots sent
 * to match the brand place its logo and say what changed, and a used
 * allowance is kept to say in place of the composer. After a brand match,
 * the check runs inside the same undo step and adds what it kept.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { defaultDesign } from '@/lib/shared/design/schema'

const server = vi.hoisted(() => ({ ask: vi.fn(), step: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({
  askPortalDesignAiFn: server.ask,
  designAgentStepFn: server.step,
}))
const loop = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/client/edit-loop', () => ({ runBuilderEditLoop: loop.run }))
const logo = vi.hoisted(() => ({ change: vi.fn() }))
vi.mock('@/lib/client/brand-logo', () => ({ brandLogoChange: logo.change }))
const stream = vi.hoisted(() => ({ match: vi.fn() }))
vi.mock('@/lib/client/brand-match-stream', () => ({ streamBrandMatch: stream.match }))
const events = vi.hoisted(() => ({ trackBuilder: vi.fn(), designerLookChosen: vi.fn() }))
vi.mock('@/lib/client/builder-events', () => events)
const shots = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/client/brand-shots', () => ({ readBrandShot: shots.read }))
vi.mock('@/lib/client/image-palette', () => ({ imagePalette: async () => ['#0058a3'] }))
const checker = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/client/brand-check', () => ({ checkBrandMatch: checker.check }))

const { useDesignAi } = await import('../use-design-ai')

beforeEach(() => {
  server.ask.mockReset()
  stream.match.mockReset()
  logo.change.mockReset()
  logo.change.mockResolvedValue(() => {})
  events.trackBuilder.mockReset()
  events.designerLookChosen.mockReset()
})

const update = vi.fn()
const hook = (view?: Parameters<typeof useDesignAi>[0]['view']) =>
  renderHook(() =>
    useDesignAi({ flush: async () => {}, adopt: vi.fn(), update, workspaceName: 'Acme', view })
  )

describe('useDesignAi', () => {
  it('records a turn made elsewhere, with its changes', () => {
    const { result } = hook()
    act(() => result.current.record({ role: 'user', text: 'Get closer to example.com' }))
    act(() =>
      result.current.record({
        role: 'assistant',
        text: 'Matched to example.com.',
        changes: [{ path: 'shape.corners', before: 'rounded', after: 'sharp' } as never],
      })
    )
    expect(result.current.turns.map((turn) => turn.text)).toEqual([
      'Get closer to example.com',
      'Matched to example.com.',
    ])
  })

  it('matches the brand from screenshots in stages, then says what changed with the logo it cut', async () => {
    update.mockReset()
    const adopt = vi.fn()
    stream.match.mockImplementation(async (_body, onStep: (step: string) => void) => {
      onStep('Reading your screenshots')
      onStep('Measuring colours and type')
      return {
        ok: true,
        reply: 'I matched your brand from your screenshot: blue as the brand colour.',
        applied: [
          {
            path: 'brand.light.accent',
            before: '#000000',
            after: '#0058a3',
            why: 'seen in the logo',
          },
        ],
        readability: [],
        design: defaultDesign(),
        report: { adjustments: [], errors: [], css: [] },
        revision: 'r2',
        asks: ['Your screenshot shows no main button. Add a screenshot of a product page.'],
        notes: ['Not visible in screenshots, so left as is: hover.'],
        chips: ['Use more blue', 'Bolder hero'],
        logo: { image: 0, box: { x: 0.03, y: 0.08, w: 0.07, h: 0.04 }, full: true, title: null },
      }
    })
    const shot = {
      id: 's1',
      jpeg: 'data:image/jpeg;base64,AAAA',
      analysis: 'data:image/jpeg;base64,BBBB',
      strip: 'data:image/png;base64,CCCC',
      hero: 'data:image/jpeg;base64,DDDD',
      width: 1440,
      height: 900,
    } as never
    const brand = { shots: [shot], name: 'Hemla', icon: null }
    const images = [{ palette: ['#ffffff'], image: 'data:image/jpeg;base64,AAAA' }]
    const { result } = renderHook(() =>
      useDesignAi({ flush: async () => {}, adopt, update, workspaceName: 'Acme' })
    )
    await act(() => result.current.ask('match my brand', 'site', images, undefined, brand))
    expect(stream.match.mock.calls[0]![0]).toEqual({
      message: 'match my brand',
      images: [
        {
          palette: ['#ffffff'],
          image: 'data:image/jpeg;base64,AAAA',
          analysis: 'data:image/jpeg;base64,BBBB',
          strip: 'data:image/png;base64,CCCC',
          hero: 'data:image/jpeg;base64,DDDD',
          width: 1440,
          height: 900,
        },
      ],
      brand: 'Hemla',
    })
    expect(server.ask).not.toHaveBeenCalled()
    // The changes land as one named step; the server cut and placed the logo, so the browser does not.
    expect(adopt).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      'Match your brand',
      'r2'
    )
    expect(logo.change).not.toHaveBeenCalled()
    const turn = result.current.turns.at(-1)
    expect(turn).toMatchObject({
      role: 'assistant',
      brand: { shot, full: true, title: null },
      asks: [expect.stringMatching(/no main button/)],
      chips: ['Use more blue', 'Bolder hero'],
    })
    expect(turn?.role === 'assistant' && turn.changes?.[0]?.why).toBe('seen in the logo')
    expect(result.current.steps).toEqual([])
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_brand_matched', {
      images: 1,
      changes: 1,
    })
    expect(events.designerLookChosen.mock.calls).toEqual([['ai']])
    // The logo's card shows it as an icon and title instead, in one step.
    await act(() => result.current.adjustLogo(1, { full: false }))
    expect(logo.change).toHaveBeenLastCalledWith(shot, expect.any(Object), {
      full: false,
      title: null,
    })
    expect(update.mock.calls.at(-1)![1]).toBe('Icon and title')
  })

  it('tells the server which screenshots were warned about, kept or not', async () => {
    stream.match.mockResolvedValue({
      ok: true,
      reply: 'I matched what I could.',
      applied: [],
      readability: [],
      design: defaultDesign(),
      logo: null,
    })
    const shot = (id: string) =>
      ({
        id,
        jpeg: 'data:image/jpeg;base64,AAAA',
        analysis: 'x',
        width: 1440,
        height: 900,
      }) as never
    const brand = {
      shots: [shot('a'), shot('b'), shot('c')],
      name: '',
      icon: null,
      warnings: ['dimmed', 'banner', null] as const,
    }
    const images = [0, 1, 2].map(() => ({ palette: [] }))
    const adopt = vi.fn()
    const { result } = renderHook(() =>
      useDesignAi({ flush: async () => {}, adopt, update, workspaceName: 'Acme' })
    )
    await act(() => result.current.ask('match my brand', 'site', images, undefined, brand))
    const sent = stream.match.mock.calls.at(-1)![0].images
    expect(sent.map((i: { told?: unknown }) => i.told)).toEqual([
      { dimmed: true },
      { banner: true },
      undefined,
    ])
  })

  it('places the mark read before sending when the server cut no logo', async () => {
    update.mockReset()
    stream.match.mockResolvedValue({
      ok: true,
      reply: 'I matched what I could.',
      applied: [],
      readability: [],
      design: defaultDesign(),
      logo: null,
    })
    const shot = {
      id: 's1',
      jpeg: 'data:image/jpeg;base64,AAAA',
      analysis: 'data:image/jpeg;base64,BBBB',
      width: 100,
      height: 50,
      pixels: new Uint8ClampedArray(100 * 50 * 4).fill(255),
      pixelWidth: 100,
      pixelHeight: 50,
    } as never
    const brand = {
      shots: [shot],
      name: 'Paylane Inc',
      icon: { image: 0, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, wordmark: false },
    }
    const { result } = hook()
    await act(() =>
      result.current.ask('match my brand', 'site', [{ palette: [] }], undefined, brand)
    )
    expect(logo.change).toHaveBeenCalledWith(shot, expect.any(Object), {
      full: false,
      title: 'Paylane Inc',
    })
    expect(result.current.turns.at(-1)).toMatchObject({
      brand: { full: false, title: 'Paylane Inc' },
    })
  })

  it('says a refused brand match in the conversation', async () => {
    stream.match.mockResolvedValue({ ok: false, code: 'AI_LIMIT', message: 'Used up.' })
    const shot = { id: 's1', jpeg: 'x', analysis: 'y', width: 1, height: 1 } as never
    const { result } = hook()
    await act(() =>
      result.current.ask('match my brand', 'site', [{ palette: [] }], undefined, {
        shots: [shot],
        name: '',
        icon: null,
      })
    )
    expect(result.current.limited).toBe('Used up.')
  })

  it('sends every attached image and shows them as thumbnails in the conversation', async () => {
    server.ask.mockResolvedValue({ ok: true, reply: 'Done.', applied: [], readability: [] })
    const { result } = hook()
    const images = [
      { palette: ['#111111'], image: 'data:image/jpeg;base64,AAAA' },
      { palette: ['#222222'], image: 'data:image/jpeg;base64,BBBB' },
    ]
    await act(() => result.current.ask('Match these', 'site', images))
    expect(server.ask.mock.calls[0]![0].data.images).toEqual(images)
    expect(server.ask.mock.calls[0]![0].data).not.toHaveProperty('image')
    expect(result.current.turns[0]).toMatchObject({
      role: 'user',
      images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'],
    })
  })

  it('keeps a used allowance to say in place of the composer', async () => {
    const message = 'Quackback AI has used this month’s allowance.'
    server.ask.mockResolvedValue({ ok: false, code: 'AI_LIMIT', message })
    const { result } = hook()
    await act(() => result.current.ask('Warmer', 'site'))
    expect(result.current.limited).toBe(message)
    expect(result.current.turns.at(-1)?.text).toBe(message)
  })

  it('sends the page and language shown with a request', async () => {
    server.ask.mockResolvedValue({ ok: false, code: 'AI_FAILED', message: 'No.' })
    const { result } = hook({ page: 'roadmap', locale: 'de' })
    await act(() => result.current.ask('Warmer', 'site'))
    expect(server.ask.mock.calls[0]![0].data).toMatchObject({ page: 'roadmap', locale: 'de' })
    expect(result.current.limited).toBeNull()
  })
})

describe('how far a request reaches, and what its reply leaves to Show changes', () => {
  const checkHooks = () => ({
    begin: vi.fn(),
    end: vi.fn(),
    replace: vi.fn(),
    frame: () => null,
    current: () => defaultDesign(),
  })
  const loopHook = () =>
    renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt: vi.fn(),
        update,
        workspaceName: 'Acme',
        check: checkHooks(),
      })
    )
  const looped = (over: object = {}) => ({
    ok: true,
    reply: 'The hero’s button is darker on hover.',
    design: defaultDesign(),
    applied: [{ path: 'overrides', before: null, after: [] }],
    steps: [],
    unmet: [],
    refused: [],
    notes: ['Left alone, as it is outside what was picked: cards.'],
    stopped: 'done',
    ms: 10,
    ...over,
  })

  beforeEach(() => loop.run.mockReset())

  it('sends the chip’s reach with a request about one part, and never for the whole site', async () => {
    server.ask.mockResolvedValue({ ok: false, code: 'AI_FAILED', message: 'No.' })
    const { result } = hook({ page: 'home', locale: 'en' })
    await act(() =>
      result.current.ask('Calmer', 'band', undefined, undefined, undefined, undefined, 'page')
    )
    expect(server.ask.mock.calls[0]![0].data).toMatchObject({ scope: 'band', within: 'page' })
    await act(() =>
      result.current.ask('Calmer', 'site', undefined, undefined, undefined, undefined, 'page')
    )
    expect(server.ask.mock.calls[1]![0].data).not.toHaveProperty('within')
  })

  it('keeps a one-call reply’s notes for Show changes', async () => {
    server.ask.mockResolvedValue({
      ok: true,
      reply: 'I changed the contact heading.',
      applied: [],
      readability: [],
      notes: ['Part of that is outside the Contact block on Home and was left alone.'],
      outOfScope: false,
      design: defaultDesign(),
    })
    const { result } = hook()
    await act(() => result.current.ask('Friendlier', 'home', undefined, 'contactbbb'))
    const reply = result.current.turns.at(-1)
    expect(reply).toMatchObject({
      text: 'I changed the contact heading.',
      notes: ['Part of that is outside the Contact block on Home and was left alone.'],
    })
    expect(reply).not.toHaveProperty('widen')
  })

  it('offers match_website to the loop only for the whole site', async () => {
    loop.run.mockResolvedValue(looped())
    const { result } = loopHook()
    await act(() =>
      result.current.ask(
        'Make the main button feel like stripe.com when hovered',
        'band',
        undefined,
        undefined,
        undefined,
        undefined,
        'every'
      )
    )
    const [request, deps] = loop.run.mock.calls[0]!
    expect(request).toMatchObject({ scope: 'band', within: 'every' })
    expect(deps.matchWebsite).toBeUndefined()
    expect(deps.readWebsite).toBeTypeOf('function')
    // What the loop left alone goes under Show changes, not into the reply.
    expect(result.current.turns.at(-1)).toMatchObject({
      text: 'The hero’s button is darker on hover.',
      notes: ['Left alone, as it is outside what was picked: cards.'],
    })
    await act(() => result.current.ask('Make it feel like stripe.com on hover', 'site'))
    expect(loop.run.mock.calls[1]![1].matchWebsite).toBeTypeOf('function')
  })

  it('shows a loop that stopped after a change with its changes and Undo, never as failed', async () => {
    loop.run.mockResolvedValue(
      looped({
        reply: 'I changed main buttons on hover, but I stopped before checking everything.',
        stopped: 'failed',
        notes: [],
      })
    )
    const { result } = loopHook()
    await act(() => result.current.ask('Make the buttons darker on hover', 'site'))
    const reply = result.current.turns.at(-1)
    expect(reply).toMatchObject({
      text: 'I changed main buttons on hover, but I stopped before checking everything.',
      changes: [{ path: 'overrides' }],
    })
  })
})

describe('the check after a brand match', () => {
  const shot = { id: 's1', jpeg: 'data:image/jpeg;base64,AAAA', width: 1440, height: 900 } as never
  const brand = { shots: [shot], name: 'Acme', icon: null }
  const images = [{ palette: ['#ffffff'], image: 'data:image/jpeg;base64,AAAA' }]
  const target = {
    fingerprint: { headline: { size: 48 } },
    checkable: true,
    roles: {
      identity: { value: '#0058A3' },
      action: { value: { hex: '#111111' } },
      links: { value: { hex: '#0058a3' } },
      highlight: { value: null },
      extras: [],
      logoColours: ['#ffdb00'],
      text: '#111111',
    },
  }
  const matched = (over: object = {}) => ({
    ok: true,
    reply: 'I matched your brand.',
    applied: [{ path: 'tune.headline.size', before: null, after: 56 }],
    readability: [],
    design: defaultDesign(),
    report: { adjustments: [], errors: [], css: [] },
    revision: 'r2',
    logo: null,
    target,
    ...over,
  })

  it('runs inside the match’s undo step and adds the revisions it kept', async () => {
    const order: string[] = []
    const hooks = {
      begin: vi.fn(() => order.push('begin')),
      end: vi.fn(() => order.push('end')),
      replace: vi.fn(),
      frame: () => null,
    }
    const adopt = vi.fn(() => order.push('adopt'))
    stream.match.mockResolvedValue(matched())
    checker.check.mockImplementation(async (input, deps) => {
      order.push('check')
      deps.progress('Checking the match: 6 to 7')
      deps.show(defaultDesign())
      return {
        rounds: [
          {
            round: 0,
            score: { measured: 80, critic: 5, combined: 6.5 },
            kept: true,
            why: '',
            changes: [],
            ms: 1,
          },
          {
            round: 1,
            score: { measured: 84, critic: 6, combined: 7.2 },
            kept: true,
            why: 'combined score rose',
            changes: [{ path: 'tune.headline.size', value: 48, why: 'measured 48px' }],
            ms: 1,
          },
        ],
        first: { measured: 80, critic: 5, combined: 6.5 },
        best: { measured: 84, critic: 6, combined: 7.2 },
        stopped: 'rounds',
        ms: 2,
      }
    })
    const { result } = renderHook(() =>
      useDesignAi({ flush: async () => {}, adopt, update, workspaceName: 'Acme', check: hooks })
    )
    await act(() => result.current.ask('match my brand', 'site', images, undefined, brand))
    expect(order).toEqual(['begin', 'adopt', 'check', 'end'])
    const [input] = checker.check.mock.calls[0]!
    expect(input).toMatchObject({
      target: target.fingerprint,
      shots: ['data:image/jpeg;base64,AAAA'],
      brand: 'Acme',
      paths: ['tune.headline.size'],
      palette: ['#0058a3', '#111111', '#ffdb00'],
    })
    expect(hooks.replace).toHaveBeenCalledWith(expect.any(Object), 'Match your brand')
    const turn = result.current.turns.at(-1)
    expect(turn?.role === 'assistant' && turn.changes).toEqual([
      { path: 'tune.headline.size', before: null, after: 48, why: 'measured 48px' },
    ])
    // The check is kept for the record, never said in the chat.
    expect(turn?.role === 'assistant' && turn.notes?.some((n) => /Checked/.test(n))).toBeFalsy()
    expect(turn?.role === 'assistant' && turn.check?.stopped).toBe('rounds')
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_brand_checked', {
      rounds: 1,
      kept: 1,
      stopped: 'rounds',
    })
  })

  it('stops at Stop: the check is cut off, the match stays, and the reply says so', async () => {
    const hooks = { begin: vi.fn(), end: vi.fn(), replace: vi.fn(), frame: () => null }
    stream.match.mockResolvedValue(matched())
    let given: AbortSignal | undefined
    let stopNow = () => {}
    checker.check.mockReset()
    checker.check.mockImplementation(async (_input, deps) => {
      given = deps.signal
      stopNow()
      return { rounds: [], first: null, best: null, stopped: 'stopped', ms: 1 }
    })
    const { result } = renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt: vi.fn(),
        update,
        workspaceName: 'Acme',
        check: hooks,
      })
    )
    stopNow = () => result.current.stop()
    await act(() => result.current.ask('match my brand', 'site', images, undefined, brand))
    expect(given?.aborted).toBe(true)
    expect(hooks.end).toHaveBeenCalledTimes(1)
    const said = result.current.turns.filter((turn) => turn.role === 'assistant')
    // The match keeps its changes and Undo; the last line says it stopped.
    expect(said.at(-2)).toMatchObject({
      text: 'I matched your brand.',
      changes: [{ path: 'tune.headline.size' }],
    })
    expect(said.at(-1)?.text).toBe('Stopped. What changed so far stays.')
  })

  it('is skipped when the match ran out of time, or without the canvas hooks', async () => {
    const hooks = { begin: vi.fn(), end: vi.fn(), replace: vi.fn(), frame: () => null }
    stream.match.mockResolvedValue(matched({ target: { ...target, checkable: false } }))
    checker.check.mockReset()
    const { result } = renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt: vi.fn(),
        update,
        workspaceName: 'Acme',
        check: hooks,
      })
    )
    await act(() => result.current.ask('match my brand', 'site', images, undefined, brand))
    stream.match.mockResolvedValue(matched())
    const bare = renderHook(() =>
      useDesignAi({ flush: async () => {}, adopt: vi.fn(), update, workspaceName: 'Acme' })
    )
    await act(() => bare.result.current.ask('match my brand', 'site', images, undefined, brand))
    expect(checker.check).not.toHaveBeenCalled()
    expect(hooks.begin).not.toHaveBeenCalled()
  })
})

describe('a website to match', () => {
  const capture = {
    host: 'acme.test',
    image: 'data:image/jpeg;base64,AAAA',
    cached: false,
    capturedAt: '2026-11-03T08:00:00.000Z',
    againFrom: '2026-11-04T08:00:00.000Z',
  }
  const matched = {
    ok: true,
    reply: 'I matched your brand.',
    design: defaultDesign(),
    applied: [],
    readability: [],
    notes: ['From acme.test: its favicon.'],
    capture,
  }

  it('given alone, is sent to be captured, and the capture shows in the reply', async () => {
    stream.match.mockResolvedValue(matched)
    const { result } = hook()
    await act(() => result.current.ask('acme.test', 'site'))
    expect(stream.match.mock.calls[0]![0]).toMatchObject({ images: [], url: 'acme.test' })
    expect(server.ask).not.toHaveBeenCalled()
    expect(result.current.turns.at(-1)).toMatchObject({
      role: 'assistant',
      capture: { ...capture, url: 'acme.test' },
      notes: ['From acme.test: its favicon.'],
    })
  })

  it('given with screenshots, is sent beside them', async () => {
    stream.match.mockResolvedValue({ ...matched, capture: undefined })
    const shot = { id: 's1', jpeg: 'x', analysis: 'y', width: 1, height: 1 } as never
    const { result } = hook()
    await act(() =>
      result.current.ask(
        'match our brand, https://acme.test',
        'site',
        [{ palette: [] }],
        undefined,
        {
          shots: [shot],
          name: '',
          icon: null,
        }
      )
    )
    expect(stream.match.mock.calls[0]![0]).toMatchObject({ url: 'https://acme.test' })
    expect(stream.match.mock.calls[0]![0].images).toHaveLength(1)
  })

  it('mentioned in a request about one part, is not matched', async () => {
    server.ask.mockResolvedValue({ ok: true, reply: 'Done.', applied: [], readability: [] })
    const { result } = hook()
    await act(() => result.current.ask('make the buttons rounder, like on acme.test', 'site'))
    expect(stream.match).not.toHaveBeenCalled()
  })

  it('captures again only when asked', async () => {
    stream.match.mockResolvedValue(matched)
    const { result } = hook()
    await act(() => result.current.recapture('acme.test'))
    expect(stream.match.mock.calls[0]![0]).toMatchObject({ url: 'acme.test', recapture: true })
  })
})

describe('a request about one part', () => {
  const partHook = () =>
    renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt: vi.fn(),
        update,
        workspaceName: 'Acme',
        check: {
          begin: vi.fn(),
          end: vi.fn(),
          replace: vi.fn(),
          frame: () => null,
          current: () => defaultDesign(),
        },
      })
    )
  beforeEach(() => {
    loop.run.mockReset()
    loop.run.mockResolvedValue({ ok: false, code: 'AI_FAILED', message: 'No.' })
    server.ask.mockResolvedValue({ ok: false, code: 'AI_FAILED', message: 'No.' })
  })

  it('never runs the whole brand match for a site named with the hero picked', async () => {
    const { result } = partHook()
    await act(() =>
      result.current.ask(
        'match stripe.com',
        'band',
        undefined,
        undefined,
        undefined,
        undefined,
        'page'
      )
    )
    expect(stream.match).not.toHaveBeenCalled()
    // The loop borrows from the site with read_website, for the hero only.
    const [request, deps] = loop.run.mock.calls[0]!
    expect(request).toMatchObject({ scope: 'band', within: 'page' })
    expect(deps.matchWebsite).toBeUndefined()
    expect(deps.readWebsite).toBeTypeOf('function')
  })

  it('never runs the whole brand match for a screenshot sent with one element picked', async () => {
    const shot = {
      id: 's1',
      jpeg: 'data:image/jpeg;base64,AAAA',
      width: 1440,
      height: 900,
    } as never
    const { result } = partHook()
    await act(() =>
      result.current.ask(
        'Match my brand from this',
        'band',
        [{ palette: ['#ffffff'], image: 'data:image/jpeg;base64,AAAA' }],
        undefined,
        { shots: [shot], name: '', icon: null },
        { element: 'button', part: 'hero.home.cta' },
        'one'
      )
    )
    expect(stream.match).not.toHaveBeenCalled()
    expect(loop.run).toHaveBeenCalledTimes(1)
  })

  it('still matches the whole brand when nothing is picked', async () => {
    stream.match.mockResolvedValue({ ok: false, code: 'X', message: 'No.' })
    const { result } = partHook()
    await act(() => result.current.ask('match stripe.com', 'site'))
    expect(stream.match).toHaveBeenCalledTimes(1)
    expect(loop.run).not.toHaveBeenCalled()
  })
})

describe('startBrandMatch', () => {
  const stamped = () => {
    const design = defaultDesign()
    design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
    return design
  }
  const outcome = () => ({
    ok: true,
    reply: 'I matched your brand.',
    design: stamped(),
    applied: [{ path: 'brand.light.accent', before: '#000000', after: '#0058a3' }],
    readability: [],
    report: { adjustments: [], errors: [], css: [] },
    revision: 'r2',
  })

  it('matches a website as Ask AI does, adopting the stamped design as one step', async () => {
    stream.match.mockResolvedValue(outcome())
    const adopt = vi.fn()
    const { result } = renderHook(() =>
      useDesignAi({ flush: async () => {}, adopt, update, workspaceName: 'Acme' })
    )
    await act(() => result.current.startBrandMatch({ website: ' acme.test ', from: 'brand_kit' }))
    expect(stream.match.mock.calls[0]![0]).toMatchObject({ images: [], url: 'acme.test' })
    expect(adopt).toHaveBeenCalledTimes(1)
    // The draft takes the design the server saved, which records that a match ran.
    expect(adopt.mock.calls[0]![0].brand.matchedAt).toBe('2026-11-07T12:00:00.000Z')
    expect(adopt.mock.calls[0]![2]).toBe('Match your brand')
    expect(result.current.turns.map((turn) => turn.role)).toEqual(['user', 'assistant'])
    expect(result.current.busy).toBe(false)
    expect(events.trackBuilder).toHaveBeenCalledWith('designer_brand_match_started', {
      from: 'brand_kit',
      website: true,
      screenshots: 0,
    })
  })

  it('sends up to three screenshots as read in the browser', async () => {
    stream.match.mockResolvedValue(outcome())
    shots.read.mockImplementation(async (file: File) => ({
      id: file.name,
      jpeg: `data:image/jpeg;base64,${file.name}`,
      analysis: 'data:image/jpeg;base64,BBBB',
      width: 1440,
      height: 900,
    }))
    const files = ['a', 'b', 'c', 'd'].map((name) => new File(['x'], name, { type: 'image/png' }))
    const { result } = hook()
    await act(() => result.current.startBrandMatch({ screenshots: files, from: 'brand_kit' }))
    const sent = stream.match.mock.calls[0]![0]
    expect(sent.images.map((image: { image: string }) => image.image)).toEqual([
      'data:image/jpeg;base64,a',
      'data:image/jpeg;base64,b',
      'data:image/jpeg;base64,c',
    ])
    expect(sent.url).toBeUndefined()
  })

  it('does nothing without a website or a screenshot', async () => {
    const { result } = hook()
    await act(() => result.current.startBrandMatch({ website: '  ', from: 'brand_kit' }))
    expect(stream.match).not.toHaveBeenCalled()
    expect(result.current.turns).toEqual([])
  })
})

describe('Stop', () => {
  it('aborts the request it sent and says so, nothing changed', async () => {
    let seen: AbortSignal | undefined
    server.ask.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          seen = signal
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          )
        })
    )
    const { result } = hook()
    let asked: Promise<void> | undefined
    act(() => {
      asked = result.current.ask('Warmer', 'site')
    })
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(result.current.busy).toBe(true)
    act(() => result.current.stop())
    await act(() => asked!)
    expect(seen?.aborted).toBe(true)
    expect(result.current.busy).toBe(false)
    expect(result.current.turns.at(-1)).toEqual({
      role: 'assistant',
      text: 'Stopped. Nothing changed.',
    })
  })

  it('takes the draft the server saved just as Stop landed, with its Undo', async () => {
    let seen: AbortSignal | undefined
    server.ask.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          seen = signal
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          )
        })
    )
    const start = defaultDesign()
    const saved = structuredClone(start)
    saved.layout.width = 'wide'
    const report = { adjustments: [], errors: [], css: [] }
    const adopt = vi.fn()
    const moved = vi.fn(async () => ({ design: saved, report, revision: 'r9' }))
    const { result } = renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt,
        moved,
        update,
        workspaceName: 'Acme',
        check: {
          begin: vi.fn(),
          end: vi.fn(),
          replace: vi.fn(),
          frame: () => null,
          current: () => start,
        },
      })
    )
    let asked: Promise<void> | undefined
    act(() => {
      asked = result.current.ask('Wider', 'site')
    })
    await vi.waitFor(() => expect(seen).toBeDefined())
    act(() => result.current.stop())
    await act(() => asked!)
    expect(adopt).toHaveBeenCalledWith(saved, report, 'Wider', 'r9')
    expect(result.current.turns.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Stopped. What changed so far stays.',
      changes: [{ path: 'layout.width', before: start.layout.width, after: 'wide' }],
    })
  })

  it('says nothing changed after Stop when the server draft did not move', async () => {
    server.ask.mockImplementation(
      ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          )
        })
    )
    const adopt = vi.fn()
    const { result } = renderHook(() =>
      useDesignAi({
        flush: async () => {},
        adopt,
        moved: async () => null,
        update,
        workspaceName: 'Acme',
      })
    )
    let asked: Promise<void> | undefined
    act(() => {
      asked = result.current.ask('Wider', 'site')
    })
    await vi.waitFor(() => expect(server.ask).toHaveBeenCalled())
    act(() => result.current.stop())
    await act(() => asked!)
    expect(adopt).not.toHaveBeenCalled()
    expect(result.current.turns.at(-1)?.text).toBe('Stopped. Nothing changed.')
  })

  it('does nothing when nothing is running', () => {
    const { result } = hook()
    act(() => result.current.stop())
    expect(result.current.turns).toEqual([])
  })

  it('aborts a brand match’s stream', async () => {
    let seen: AbortSignal | undefined
    stream.match.mockImplementation(
      (_body: unknown, _onStep: unknown, _fetcher: unknown, signal?: AbortSignal) =>
        new Promise((_, reject) => {
          seen = signal
          signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          )
        })
    )
    const { result } = hook()
    let asked: Promise<void> | undefined
    act(() => {
      asked = result.current.ask('Match https://example.com', 'site')
    })
    await vi.waitFor(() => expect(seen).toBeDefined())
    act(() => result.current.stop())
    await act(() => asked!)
    expect(seen?.aborted).toBe(true)
    expect(result.current.turns.at(-1)?.text).toBe('Stopped. Nothing changed.')
  })
})
