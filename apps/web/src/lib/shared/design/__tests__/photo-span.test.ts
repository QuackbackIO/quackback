/**
 * A hero photo running up behind the header: one picture, sized to cover the
 * header and the band together, placed so the header shows its top and the
 * band the rest, cropped toward the design's focal point.
 */
import { describe, expect, it } from 'vitest'
import { focusPoint, photoSpan } from '../photo-span'

describe('photoSpan', () => {
  it('covers the header and the band together, the header showing the top', () => {
    const span = photoSpan({
      natural: { width: 2880, height: 1000 },
      width: 1440,
      band: 400,
      header: 80,
      focus: { x: 50, y: 50 },
    })
    // 1440 wide covers 480 tall: the picture is 1440 x 500, 20px left over, split by the focus.
    expect(span.size).toBe('1440px 500px')
    expect(span.header).toBe('0px -10px')
    expect(span.band).toBe('0px -90px')
  })

  it('crops a picture too narrow for the width toward its focal point', () => {
    const span = photoSpan({
      natural: { width: 1000, height: 1000 },
      width: 1200,
      band: 300,
      header: 60,
      focus: { x: 100, y: 0 },
    })
    expect(span.size).toBe('1200px 1200px')
    expect(span.header).toBe('0px 0px')
    expect(span.band).toBe('0px -60px')
    const tall = photoSpan({
      natural: { width: 400, height: 1000 },
      width: 1200,
      band: 300,
      header: 60,
      focus: { x: 50, y: 100 },
    })
    // 1200 x 3000: the focus at its foot shows its last 360px.
    expect(tall.header).toBe('0px -2640px')
  })
})

describe('focusPoint', () => {
  it('reads the focus token: an exact point or a side', () => {
    expect(focusPoint('63% 20%')).toEqual({ x: 63, y: 20 })
    expect(focusPoint('left')).toEqual({ x: 0, y: 50 })
    expect(focusPoint('right')).toEqual({ x: 100, y: 50 })
    expect(focusPoint('')).toEqual({ x: 50, y: 50 })
  })
})
