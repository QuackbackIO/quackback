import { describe, it, expect } from 'vitest'
import { scaleImageInsertSize } from '../resizable-image-insert-attrs'

describe('scaleImageInsertSize', () => {
  it('keeps a landscape screenshot proportional under the 500px cap', () => {
    expect(scaleImageInsertSize(1920, 1080)).toEqual({ width: 500, height: 281 })
  })

  it('does not upscale a small image', () => {
    expect(scaleImageInsertSize(200, 100)).toEqual({ width: 200, height: 100 })
  })

  it('does not emit a 1:1 box for a wide image', () => {
    const { width, height } = scaleImageInsertSize(1600, 900)
    expect(width).toBe(500)
    expect(width / height).toBeCloseTo(1600 / 900, 2)
  })
})
