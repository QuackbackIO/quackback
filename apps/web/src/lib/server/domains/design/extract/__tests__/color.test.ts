/**
 * Colour maths against published references: CIEDE2000 on pairs from Sharma,
 * Wu and Dalal's test data (2005), CIELAB of sRGB white and black, and hex
 * parsing both ways.
 */
import { describe, expect, it } from 'vitest'
import { deltaE00, deltaE00Lab, hex, lab, okDist, oklab, parseColor, type RGB } from '../color'

const SHARMA: [RGB, RGB, number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
]

describe('colour', () => {
  it.each(SHARMA)('deltaE00 %j to %j is %d', (a, b, expected) => {
    expect(deltaE00Lab(a, b)).toBeCloseTo(expected, 4)
    expect(deltaE00Lab(b, a)).toBeCloseTo(expected, 4)
  })

  it('reads sRGB white and black in CIELAB', () => {
    // The sRGB matrix is the common four-decimal one, so white is neutral to about 0.01.
    const white = lab([255, 255, 255])
    expect(white[0]).toBeCloseTo(100, 2)
    expect(Math.abs(white[1])).toBeLessThan(0.02)
    expect(Math.abs(white[2])).toBeLessThan(0.02)
    expect(lab([0, 0, 0])[0]).toBeCloseTo(0, 5)
  })

  it('measures the same colour as zero apart and black from white far apart', () => {
    expect(deltaE00([0, 88, 163], [0, 88, 163])).toBe(0)
    expect(deltaE00([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 0)
    expect(okDist([10, 20, 30], [10, 20, 30])).toBe(0)
    expect(oklab([255, 255, 255])[0]).toBeCloseTo(1, 3)
  })

  it('writes and parses hex and rgb()', () => {
    expect(hex([0, 88, 163])).toBe('#0058a3')
    expect(hex([255.4, -3, 300])).toBe('#ff00ff')
    expect(parseColor('#0058A3')).toEqual([0, 88, 163])
    expect(parseColor('#fd0')).toEqual([255, 221, 0])
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual([1, 2, 3])
    expect(parseColor('rgb(1 2 3)')).toEqual([1, 2, 3])
    expect(parseColor('blue')).toBeNull()
    expect(parseColor(null)).toBeNull()
  })
})
