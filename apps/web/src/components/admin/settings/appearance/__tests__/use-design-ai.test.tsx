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

const server = vi.hoisted(() => ({ ask: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design-ai', () => ({ askPortalDesignAiFn: server.ask }))
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
