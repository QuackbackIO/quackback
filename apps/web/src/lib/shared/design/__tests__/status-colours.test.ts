import { describe, expect, it } from 'vitest'
import { brandStatusColour } from '../status-colours'

// A four-colour logo: yellow, blue, magenta and green.
const LOGO = ['#ecb22e', '#36c5f0', '#e01e5a', '#2eb67d']

describe('status colours in a brand’s own colours', () => {
  it('takes the logo colour nearest each status’s hue', () => {
    expect(brandStatusColour('#f59e0b', LOGO)).toBe('#ecb22e') // amber to yellow
    expect(brandStatusColour('#3b82f6', LOGO)).toBe('#36c5f0') // blue to blue
    expect(brandStatusColour('#22c55e', LOGO)).toBe('#2eb67d') // green to green
    expect(brandStatusColour('#ef4444', LOGO)).toBe('#e01e5a') // red to magenta
  })

  it('leaves greys, and every status without logo colours, as they are', () => {
    expect(brandStatusColour('#6b7280', LOGO)).toBe('#6b7280')
    expect(brandStatusColour('#3b82f6', [])).toBe('#3b82f6')
    expect(brandStatusColour('#3b82f6', ['#111111', '#f5f5f5'])).toBe('#3b82f6')
  })
})
