/**
 * The measure stage runs on a worker thread and answers exactly as it does
 * in process; a worker that fails to start, dies or hangs leaves the stage
 * to run in process with the same answer.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FoundElements } from '../../extract/finder'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import type { Shot } from '../brand-measure'
import { measureInWorker, measureOffThread, measureShots } from '../measure-stage'

const BLUE = [0, 88, 163]

/** A white page with a blue logo and button and dark text; `dim` darkens every pixel. */
function page(index: number, dim = 1, banner = false): Shot {
  const width = 960
  const img = { width, height: 600, data: new Uint8Array(width * 600 * 4).fill(255) }
  const fill = ([x0, y0, x1, y1]: Box, c: number[]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) img.data.set([c[0]!, c[1]!, c[2]!, 255], (y * width + x) * 4)
  }
  fill([32, 20, 112, 44], BLUE)
  fill([700, 300, 860, 344], BLUE)
  for (let x = 64; x < 600; x += 8) fill([x, 160, x + 4, 200], [17, 17, 17])
  for (let x = 64; x < 600; x += 8) fill([x, 420, x + 3, 432], [17, 17, 17])
  if (dim !== 1)
    for (let i = 0; i < img.data.length; i += 4)
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k]! * dim)
  const boxes = Object.fromEntries(BOX_KINDS.map((k) => [k, null])) as Record<BoxKind, Box | null>
  Object.assign(boxes, {
    header: [0, 0, 960, 64],
    logo: [32, 20, 112, 44],
    hero: [0, 64, 960, 380],
    headline: [60, 156, 604, 204],
    primary_button: [700, 300, 860, 344],
  })
  return {
    index,
    img,
    strip: null,
    width,
    height: 600,
    told: dim !== 1 ? { dimmed: true } : {},
    found: {
      version: 'test',
      scale: 1,
      boxes,
      snapped: boxes,
      output: {
        headline_text: 'Plan and ship your best work',
        subtitle_text: '',
        behind_headline: 'plain',
        logo_kind: 'wordmark',
        dimmed: false,
        cookie_banner: banner,
      },
    } as unknown as FoundElements,
  }
}

const shots = () => [page(0, 0.25), page(1, 1, true)]

function script(name: string, body: string): URL {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'measure-worker-')), name)
  writeFileSync(file, body)
  return pathToFileURL(file)
}

describe('measureOffThread', () => {
  it('gives on a worker exactly what the stage gives in process', async () => {
    const s = shots()
    const expected = measureShots(s, s[1]!)
    expect(expected.logo).not.toBeNull()
    const outcome = await measureInWorker({ shots: s, primary: 1 }, 30_000)
    expect(outcome).toStrictEqual({ ok: true, measures: expected })
  }, 60_000)

  it('leaves the screenshots readable after the stage', async () => {
    const s = shots()
    await measureOffThread(s, s[1]!)
    expect(s[1]!.img.data.length).toBe(960 * 600 * 4)
  }, 60_000)

  it('measures in process when the worker cannot start', async () => {
    const s = shots()
    const measured = await measureOffThread(s, s[1]!, {
      workerUrl: pathToFileURL(path.join(tmpdir(), 'no-such-measure-worker.mjs')),
    })
    expect(measured).toStrictEqual(measureShots(s, s[1]!))
  }, 60_000)

  it('measures in process when the worker dies', async () => {
    const s = shots()
    const measured = await measureOffThread(s, s[1]!, {
      workerUrl: script('dies.mjs', 'process.exit(3)\n'),
    })
    expect(measured).toStrictEqual(measureShots(s, s[1]!))
  }, 60_000)

  it('stops a worker past its deadline and measures in process', async () => {
    const s = shots()
    const started = Date.now()
    const measured = await measureOffThread(s, s[1]!, {
      deadlineMs: 300,
      workerUrl: script(
        'hangs.mjs',
        "import { parentPort } from 'node:worker_threads'\nparentPort.on('message', () => {})\nsetInterval(() => {}, 1000)\n"
      ),
    })
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(measured).toStrictEqual(measureShots(s, s[1]!))
  }, 60_000)
})
