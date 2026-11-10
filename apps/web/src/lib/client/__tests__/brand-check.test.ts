// @vitest-environment happy-dom
/**
 * The builder's side of the check: it reads the drawn preview and its
 * picture, asks the server to score and to revise (saving the draft first),
 * shows a candidate and reads it once it has drawn, and puts the best back
 * when the candidate measures worse. The reader finds the portal's parts by
 * the rig's selectors.
 */
import { describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { BRAND_CHECK_URL, checkBrandMatch } from '../brand-check'
import { readFingerprint } from '../preview-fingerprint'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

describe('checkBrandMatch', () => {
  it('scores, revises, shows the candidate, and puts the best back when it measures worse', async () => {
    const candidate = { ...defaultDesign(), name: 'candidate' } as never
    const scores = [
      { ok: true, measured: 80, critic: 6, combined: 7, answer: { glance: 6 }, gaps: [] },
      { ok: true, measured: 75, critic: 9, combined: 8.25, answer: null, gaps: [] },
    ]
    const bodies: Array<Record<string, unknown>> = []
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(BRAND_CHECK_URL)
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      bodies.push(body)
      if (body.op === 'score') return json(scores.shift())
      return json({
        ok: true,
        changes: [{ path: 'tune.headline.size', value: 48, why: 'measured' }],
        design: candidate,
      })
    })
    const order: string[] = []
    const shown: unknown[] = []
    const reads: Array<{ before?: unknown }> = []
    const start = defaultDesign()
    const report = await checkBrandMatch(
      {
        target: { headline: { size: 48 } },
        shots: ['data:image/jpeg;base64,AAAA'],
        brand: 'Acme',
        paths: ['tune.headline.size'],
        palette: ['#0058a3'],
        design: start,
      },
      {
        frame: () => null,
        show: (d) => {
          order.push('show')
          shown.push(d)
        },
        flush: async () => {
          order.push('flush')
        },
        progress: () => {},
        fetcher: fetcher as unknown as typeof fetch,
        capture: async () => 'data:image/jpeg;base64,PIC',
        read: (async (_frame: unknown, opts: { before?: unknown }) => {
          reads.push(opts)
          return { headline: { size: reads.length === 1 ? 56 : 50 } }
        }) as never,
      }
    )
    expect(bodies[0]).toMatchObject({
      op: 'score',
      round: 0,
      target: { headline: { size: 48 } },
      actual: { headline: { size: 56 } },
      picture: 'data:image/jpeg;base64,PIC',
      shots: ['data:image/jpeg;base64,AAAA'],
      brand: 'Acme',
    })
    expect(bodies[1]).toMatchObject({
      op: 'revise',
      round: 1,
      critic: { glance: 6 },
      paths: ['tune.headline.size'],
      palette: ['#0058a3'],
    })
    // The second read waits for the candidate to draw over the first reading.
    expect(reads[1]).toEqual({ before: { headline: { size: 56 } } })
    expect(order).toEqual(['flush', 'show', 'show'])
    expect(shown).toEqual([candidate, start])
    expect(report.stopped).toBe('no_gain')
    expect(report.rounds[1]).toMatchObject({ kept: false })
  })

  it('stops on a refusal, keeping the design as applied', async () => {
    const fetcher = vi.fn(async () =>
      json({
        ok: false,
        code: 'AI_LIMIT',
        message: 'Quackback AI has used this month’s allowance.',
      })
    )
    const show = vi.fn()
    const report = await checkBrandMatch(
      { target: {}, shots: ['x'], paths: [], palette: [], design: defaultDesign() },
      {
        frame: () => null,
        show,
        flush: async () => {},
        progress: () => {},
        fetcher: fetcher as unknown as typeof fetch,
        capture: async () => null,
        read: (async () => ({})) as never,
      }
    )
    expect(report).toMatchObject({ stopped: 'failed', error: expect.stringMatching(/allowance/) })
    expect(show).not.toHaveBeenCalled()
  })
})

describe('checkBrandMatch on its own frame', () => {
  it('reads Home in the check’s frame, shows each design there too, and closes it after', async () => {
    const candidate = { ...defaultDesign(), name: 'candidate' } as never
    const start = defaultDesign()
    const probeFrame = { id: 'probe' } as unknown as HTMLIFrameElement
    const probe = { frame: () => probeFrame, show: vi.fn(), close: vi.fn() }
    const open = vi.fn(async () => probe)
    const frames: unknown[] = []
    const scores = [
      { ok: true, measured: 80, critic: 6, combined: 7, answer: null, gaps: [] },
      { ok: true, measured: 90, critic: 7, combined: 8, answer: null, gaps: [] },
    ]
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if (body.op === 'score') return json(scores.shift())
      return body.round === 1
        ? json({
            ok: true,
            changes: [{ path: 'tune.headline.weight', value: 300, why: 'w' }],
            design: candidate,
          })
        : json({ ok: true, changes: [], design: null })
    })
    const show = vi.fn()
    let reads = 0
    const report = await checkBrandMatch(
      {
        target: { headline: { weight: 300 } },
        shots: ['x'],
        paths: ['tune.headline.weight'],
        palette: [],
        design: start,
      },
      {
        frame: () => null,
        open,
        show,
        flush: async () => {},
        progress: () => {},
        fetcher: fetcher as unknown as typeof fetch,
        capture: async (frame) => {
          frames.push(frame)
          return null
        },
        read: (async (frame: () => unknown) => {
          frames.push(frame())
          reads++
          return { headline: { weight: reads === 1 ? 500 : 300 } }
        }) as never,
      }
    )
    expect(open).toHaveBeenCalledWith(start)
    expect(frames.every((f) => f === probeFrame)).toBe(true)
    expect(show).toHaveBeenCalledWith(candidate)
    expect(probe.show).toHaveBeenCalledWith(candidate)
    expect(probe.close).toHaveBeenCalledTimes(1)
    expect(report.rounds[1]).toMatchObject({ kept: true })
  })

  it('reads the canvas when its own frame cannot open', async () => {
    const canvas = { id: 'canvas' } as unknown as HTMLIFrameElement
    const frames: unknown[] = []
    await checkBrandMatch(
      { target: {}, shots: ['x'], paths: [], palette: [], design: defaultDesign() },
      {
        frame: () => canvas,
        open: async () => {
          throw new Error('not ready')
        },
        show: () => {},
        flush: async () => {},
        progress: () => {},
        fetcher: (async () =>
          json({
            ok: true,
            measured: 99,
            critic: 9,
            combined: 9.5,
            answer: null,
            gaps: [],
          })) as never,
        capture: async (frame) => {
          frames.push(frame)
          return null
        },
        read: (async (frame: () => unknown) => {
          frames.push(frame())
          return {}
        }) as never,
      }
    )
    expect(frames).toEqual([canvas, canvas])
  })

  it('does not ask the critic about a candidate whose measured score fell', async () => {
    const candidate = { ...defaultDesign(), name: 'candidate' } as never
    const ops: string[] = []
    let reads = 0
    const report = await checkBrandMatch(
      {
        target: { headline: { size: 48 } },
        shots: ['x'],
        paths: ['tune.headline.size'],
        palette: [],
        design: defaultDesign(),
      },
      {
        frame: () => null,
        show: () => {},
        flush: async () => {},
        progress: () => {},
        fetcher: (async (_url: string, init: RequestInit) => {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>
          ops.push(String(body.op))
          return body.op === 'score'
            ? json({ ok: true, measured: 100, critic: 6, combined: 8, answer: null, gaps: [] })
            : json({
                ok: true,
                changes: [{ path: 'tune.headline.size', value: 80, why: 'w' }],
                design: candidate,
              })
        }) as never,
        capture: async () => null,
        read: (async () => {
          reads++
          return { headline: { size: reads === 1 ? 48 : 80 } }
        }) as never,
      }
    )
    expect(ops).toEqual(['score', 'revise'])
    expect(report.rounds[1]).toMatchObject({ kept: false, score: { critic: null } })
  })
})

describe('readFingerprint', () => {
  it('reads the portal’s parts by the rig’s selectors', () => {
    document.body.innerHTML = `
      <header><a data-qb-part="nav-item" style="color: rgb(1, 2, 3); font-size: 14px">Feedback</a></header>
      <main>
        <h1 data-qb-part="headline" style="font-size: 48px; font-weight: 300; text-transform: uppercase">Hello</h1>
        <h2 style="font-size: 20px">Popular</h2>
        <p style="font-size: 16px">A paragraph long enough to count as the body text of this page.</p>
        <button data-slot="button" data-variant="default" style="background-color: rgb(99, 91, 255); border-radius: 4px">Send</button>
        <div data-qb-surface="card" style="border-radius: 12px">Card</div>
      </main>`
    // happy-dom lays nothing out: give every element a size, and an opacity to read.
    for (const el of document.querySelectorAll('*')) (el as HTMLElement).style.opacity = '1'
    for (const el of document.querySelectorAll('*'))
      el.getBoundingClientRect = () =>
        ({ width: 200, height: 40, top: 10, left: 0, right: 200, bottom: 50 }) as DOMRect
    const fp = readFingerprint(document)
    expect(fp.headline).toMatchObject({ size: 48, weight: 300, transform: 'uppercase' })
    expect(fp.heading).toMatchObject({ size: 20 })
    expect(fp.body).toMatchObject({ size: 16 })
    expect(fp.link).toMatchObject({ size: 14, color: 'rgb(1, 2, 3)' })
    expect(fp.button).toMatchObject({ bg: 'rgb(99, 91, 255)', radius: 4, height: 40 })
    expect(fp.buttonText).toBe('Send')
    // Corners as round as half the height read as fully round.
    expect(fp.card).toMatchObject({ radius: 12 })
  })
})
