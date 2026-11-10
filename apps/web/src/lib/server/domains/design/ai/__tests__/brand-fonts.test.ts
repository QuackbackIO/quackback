/**
 * Font matching off the request thread: drawing a crop's words in every
 * bundled face takes 0.3 to 1.5 s of CPU, so it runs on a worker thread and
 * the server keeps answering meanwhile. The worker gets only the text crops;
 * a worker that cannot start or dies falls back to matching in process, and
 * one past its deadline is stopped and gives no match.
 */
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FoundElements } from '../../extract/finder'
import { BOX_KINDS, type Box, type BoxKind } from '../../extract/kinds'
import type { Image } from '../../extract/png'
import { faceById } from '../../extract/fonts/faces'
import { fontFor, renderText } from '../../extract/fonts/woff'
import { matchText } from '../../extract/fonts/type-match'
import { matchTypeOffThread, typeCrops } from '../brand-fonts'
import type { Shot } from '../brand-measure'

const HEADLINE = 'Plan and ship your best work'
const SUBTITLE = 'The tool for teams who build software together'

function blank(width: number, height: number): Image {
  return { width, height, data: new Uint8Array(width * height * 4).fill(255) }
}

function draw(
  img: Image,
  id: string,
  weight: number,
  size: number,
  text: string,
  x: number,
  y: number
): Box {
  const drawn = renderText(fontFor(faceById(id)!, weight)!, size, text)
  let box: Box = [img.width, img.height, 0, 0]
  for (let j = 0; j < drawn.mask.h; j++)
    for (let i = 0; i < drawn.mask.w; i++) {
      const a = drawn.mask.a[j * drawn.mask.w + i]!
      if (!a) continue
      const o = ((y + j) * img.width + x + i) * 4
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(255 * (1 - a) + 17 * a)
      if (a > 0.3)
        box = [
          Math.min(box[0], x + i),
          Math.min(box[1], y + j),
          Math.max(box[2], x + i + 1),
          Math.max(box[3], y + j + 1),
        ]
    }
  return [box[0] - 3, box[1] - 3, box[2] + 3, box[3] + 3]
}

/** A page with a Lora headline and an Inter subtitle, its finder boxes and words. */
function page(): Shot {
  const img = blank(1000, 700)
  const boxes = Object.fromEntries(BOX_KINDS.map((k) => [k, null])) as Record<BoxKind, Box | null>
  boxes.headline = draw(img, 'lora', 600, 44, HEADLINE, 60, 120)
  boxes.subtitle = draw(img, 'inter', 400, 18, SUBTITLE, 60, 220)
  return {
    index: 0,
    img,
    strip: null,
    width: img.width,
    height: img.height,
    found: {
      version: 'test',
      scale: 1,
      boxes,
      snapped: boxes,
      output: { headline_text: HEADLINE, subtitle_text: SUBTITLE },
    } as unknown as FoundElements,
  }
}

describe('typeCrops', () => {
  it('cuts each text with a margin, and matching the crop equals matching the page', () => {
    const shot = page()
    const crops = typeCrops(shot)
    expect(crops.headline!.img.width).toBeLessThan(shot.img.width)
    expect(crops.headline!.img.height).toBeLessThan(shot.img.height)
    const whole = matchText(shot.img, shot.found.snapped.headline, HEADLINE)!
    const cut = matchText(crops.headline!.img, crops.headline!.box, HEADLINE)!
    expect(cut.face.id).toBe(whole.face.id)
    expect(cut.size).toBeCloseTo(whole.size, 5)
    expect(cut.weight).toBe(whole.weight)
  })

  it('gives no crop for a text without its words or its box', () => {
    const shot = page()
    shot.found.output.subtitle_text = ''
    shot.found.snapped.headline = null
    expect(typeCrops(shot)).toEqual({ headline: null, body: null })
  })
})

describe('matchTypeOffThread', () => {
  it('matches on a worker thread while this thread keeps running', async () => {
    const shot = page()
    let ticks = 0
    const timer = setInterval(() => ticks++, 5)
    const started = Date.now()
    const matched = await matchTypeOffThread(shot, { deadlineMs: 30_000 })
    const took = Date.now() - started
    clearInterval(timer)
    expect(matched.headline?.face.id).toBe('lora')
    expect(matched.body?.face.id).toMatch(/^inter/)
    // A thread blocked for the whole match would tick once or not at all.
    expect(ticks).toBeGreaterThan(Math.min(10, took / 20))
  }, 60_000)

  it('matches in process when the worker cannot start', async () => {
    const matched = await matchTypeOffThread(page(), {
      deadlineMs: 30_000,
      workerUrl: pathToFileURL(path.join(tmpdir(), 'no-such-type-worker.mjs')),
    })
    expect(matched.headline?.face.id).toBe('lora')
  }, 60_000)

  it('matches in process when the worker dies', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'type-worker-'))
    const script = path.join(dir, 'dies.mjs')
    writeFileSync(script, 'process.exit(3)\n')
    const matched = await matchTypeOffThread(page(), {
      deadlineMs: 30_000,
      workerUrl: pathToFileURL(script),
    })
    expect(matched.headline?.face.id).toBe('lora')
  }, 60_000)

  it('stops a worker past its deadline and gives no match', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'type-worker-'))
    const script = path.join(dir, 'hangs.mjs')
    writeFileSync(
      script,
      "import { parentPort } from 'node:worker_threads'\nparentPort.on('message', () => {})\nsetInterval(() => {}, 1000)\n"
    )
    const started = Date.now()
    const matched = await matchTypeOffThread(page(), {
      deadlineMs: 300,
      workerUrl: pathToFileURL(script),
    })
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(matched).toEqual({ headline: null, body: null })
  })
})
