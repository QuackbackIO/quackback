/**
 * A capture becomes a screenshot as the builder makes one from a pasted
 * image: the page for the tools, its top at its own resolution for the logo
 * and the fonts, and a small picture for the model and the conversation.
 */
import { describe, expect, it } from 'vitest'
import { decodeDataUrl } from '../../extract/image'
import { encodePng } from '../../extract/png'
import { shotFromCapture } from '../capture-shots'

function page(width: number, height: number, grey = 240) {
  return { width, height, data: new Uint8Array(width * height * 4).fill(grey) }
}

describe('shotFromCapture', () => {
  it('makes the analysis image, the strip and the model picture', () => {
    const out = shotFromCapture(encodePng(page(1440, 900)))!
    expect(out.shot).toMatchObject({ width: 1440, height: 900 })
    expect(out.shot.analysis.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(out.shot.strip!.startsWith('data:image/png;base64,')).toBe(true)
    expect(decodeDataUrl(out.shot.strip!).height).toBe(900)
    const small = decodeDataUrl(out.jpeg)
    expect(small.width).toBe(1024)
    expect(out.dimmed).toBe(false)
  })

  it('keeps the strip to the top of a tall page', () => {
    const out = shotFromCapture(encodePng(page(1440, 3000)))!
    expect(decodeDataUrl(out.shot.strip!).height).toBe(900)
    expect(decodeDataUrl(out.shot.analysis).height).toBe(2400)
  })

  it('gives nothing for bytes that are not an image', () => {
    expect(shotFromCapture(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})
