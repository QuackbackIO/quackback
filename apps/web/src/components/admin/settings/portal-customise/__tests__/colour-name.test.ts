/**
 * A colour's plain name for the chat's reply: hue and lightness, nothing
 * finer. The hex stays in the swatch's tooltip.
 */
import { describe, expect, it } from 'vitest'
import { colourName } from '../colour-name'

describe('colourName', () => {
  it.each([
    ['#0b1f3a', 'navy'],
    ['#15803d', 'green'],
    ['#14532d', 'dark green'],
    ['#bbf7d0', 'light green'],
    ['#ffffff', 'white'],
    ['#f8f6f1', 'off-white'],
    ['#e5e7eb', 'light grey'],
    ['#6b7280', 'grey'],
    ['#27272a', 'dark grey'],
    ['#0a0a0a', 'black'],
    ['#ea580c', 'orange'],
    ['#e11d48', 'red'],
    ['#facc15', 'yellow'],
    ['#0f766e', 'teal'],
    ['#1a73e8', 'blue'],
    ['#bfdbfe', 'light blue'],
    ['#7c3aed', 'purple'],
    ['#db2777', 'pink'],
    ['#78350f', 'brown'],
  ])('%s is %s', (hex, name) => {
    expect(colourName(hex)).toBe(name)
  })

  it('reads any case, and short hex', () => {
    expect(colourName('#0B1F3A')).toBe('navy')
    expect(colourName('#fff')).toBe('white')
  })

  it('names nothing it cannot read', () => {
    expect(colourName('not a colour')).toBeNull()
  })
})
