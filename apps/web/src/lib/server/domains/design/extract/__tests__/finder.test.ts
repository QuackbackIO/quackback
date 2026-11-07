/**
 * The element finder: its few-shot examples stay in step with the schema,
 * box answers parse in pixels, and a call returns boxes in the full image's
 * pixels (a retina capture's halved boxes scaled back) and snapped.
 */
import { describe, expect, it, vi } from 'vitest'
import { findElements, type FinderRequest } from '../finder'
import { examplesFor, FINDER_EXAMPLES, FINDER_VERSION, finderPrompt } from '../finder-prompt'
import { finderSchema, parseBox, type FinderOutput } from '../finder-schema'
import { BOX_KINDS } from '../kinds'
import { decodePng, type Image } from '../png'

describe('finder examples', () => {
  it('every example parses with the schema', () => {
    for (const e of FINDER_EXAMPLES) expect(() => finderSchema.parse(e.output)).not.toThrow()
    for (const e of examplesFor(1440, 900)) expect(() => finderSchema.parse(e)).not.toThrow()
  })

  it('examples name exactly the schema fields', () => {
    const fields = Object.keys(finderSchema.shape).sort()
    for (const e of FINDER_EXAMPLES) expect(Object.keys(e.output).sort()).toEqual(fields)
  })

  it('example boxes in the prompt are pixels of the image sent', () => {
    for (const e of examplesFor(1440, 900)) {
      for (const k of BOX_KINDS) {
        const v = e[k]
        if (v === 'none') continue
        expect(v).toMatch(/^\d+ \d+ \d+ \d+$/)
        expect(parseBox(v, [1440, 900])).not.toBeNull()
      }
    }
    const prompt = finderPrompt(1440, 900)
    expect(prompt).toContain('"logo":"58 27 170 61"')
    expect(prompt).toContain('in whole pixels of this 1440x900 image')
    expect(FINDER_VERSION).toBe('finder-v5-type')
  })

  it('reads the type’s category and boxes the next section’s heading', () => {
    const prompt = finderPrompt(1440, 900)
    expect(prompt).toContain('- headline_type and body_type:')
    expect(prompt).toContain('- section_heading:')
    // The examples show both a serif and a sans reading, and a heading box.
    const kinds = FINDER_EXAMPLES.map((e) => e.output.headline_type)
    expect(kinds).toEqual(expect.arrayContaining(['sans', 'serif']))
    expect(FINDER_EXAMPLES.some((e) => e.output.section_heading !== 'none')).toBe(true)
  })

  it('keeps the structured output grammar flat', () => {
    for (const field of Object.values(finderSchema.shape)) {
      expect(['string', 'enum', 'boolean']).toContain(field.def.type)
    }
  })
})

describe('parseBox', () => {
  it('reads pixels, swapped corners, percent and none', () => {
    expect(parseBox('none')).toBeNull()
    expect(parseBox('720 450 1440 900', [1440, 900])).toEqual([0.5, 0.5, 1, 1])
    expect(parseBox('0.5 0.6 0.1 0.2')).toEqual([0.1, 0.2, 0.5, 0.6])
    expect(parseBox('[10, 20, 30, 40]')).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(parseBox('5 5 5 9', [100, 100])).toBeNull()
    expect(parseBox('1 2 3')).toBeNull()
  })
})

/** A white page with a dark header bar and a blue button. */
function page(width: number, height: number, s: number): Image {
  const data = new Uint8Array(width * height * 4).fill(255)
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0 * s; y < y1 * s; y++)
      for (let x = x0 * s; x < x1 * s; x++) data.set([...c, 255], (y * width + x) * 4)
  }
  fill(0, 0, width / s, 64, [24, 24, 24])
  fill(200, 400, 320, 444, [0, 88, 163])
  return { width, height, data }
}

const answer = (boxes: Partial<FinderOutput>): FinderOutput => ({
  ...FINDER_EXAMPLES[0]!.output,
  ...Object.fromEntries(BOX_KINDS.map((k) => [k, 'none'])),
  ...boxes,
})

describe('findElements', () => {
  it('asks once with the prompt and image, and returns snapped pixel boxes', async () => {
    const img = page(1440, 900, 1)
    const call = vi.fn(async (_req: FinderRequest) =>
      answer({ primary_button: '190 392 330 452', header: '0 0 1440 60' })
    )
    const found = await findElements(img, call)
    expect(call).toHaveBeenCalledTimes(1)
    const req = call.mock.calls[0]![0]
    expect([req.width, req.height]).toEqual([1440, 900])
    expect(req.prompt).toBe(finderPrompt(1440, 900))
    expect(decodePng(req.png).width).toBe(1440)
    expect(found.scale).toBe(1)
    expect(found.boxes.primary_button).toEqual([190, 392, 330, 452])
    expect(found.snapped.primary_button).toEqual([200, 400, 320, 444])
    expect(found.snapped.header?.slice(0, 3)).toEqual([0, 0, 1440])
    expect(Math.abs(found.snapped.header![3] - 64)).toBeLessThanOrEqual(1)
    expect(found.boxes.logo).toBeNull()
    expect(found.output.headline_text).toBe('Plan, track and ship your work')
  })

  it('halves a retina capture for the model and scales its boxes back', async () => {
    const img = page(2880, 1800, 2)
    const call = vi.fn(async (_req: FinderRequest) => answer({ primary_button: '190 392 330 452' }))
    const found = await findElements(img, call)
    const req = call.mock.calls[0]![0]
    expect([req.width, req.height]).toEqual([1440, 900])
    expect(found.scale).toBe(2)
    expect(found.boxes.primary_button).toEqual([380, 784, 660, 904])
    expect(found.snapped.primary_button).toEqual([400, 800, 640, 888])
  })

  it('refuses an answer off the schema', async () => {
    const img = page(1440, 900, 1)
    await expect(findElements(img, async () => ({ logo: '1 2 3 4' }))).rejects.toThrow()
  })
})
