/**
 * Colours on the Customise page: a hex box that takes the formats people
 * paste, and the swatches offered for each role.
 */
import { describe, expect, it } from 'vitest'
import { tryCssColorToHex } from '@/lib/shared/theme'
import { parseColourInput, roleSuggestions } from '../colours'

describe('parseColourInput', () => {
  it.each([
    ['533AFD', '#533afd'],
    ['#533afd', '#533afd'],
    ['#53f', '#5533ff'],
    ['rgb(83, 58, 253)', '#533afd'],
    ['  #533AFD ', '#533afd'],
  ])('reads %s', (input, hex) => {
    expect(parseColourInput(input)).toBe(hex)
  })

  it.each(['', 'blue-ish', '#12', 'rgb(1,2)'])('refuses %j', (input) => {
    expect(parseColourInput(input)).toBeNull()
  })
})

describe('roleSuggestions', () => {
  it('offers site colours first, then the role suggestions, ten at most', () => {
    const swatches = roleSuggestions('primary', 'light', { primary: '#533afd' }, ['#010203'])
    expect(swatches[0]!.hex).toBe('#010203')
    expect(swatches.length).toBeLessThanOrEqual(10)
    expect(swatches.map((s) => s.hex)).toContain('#2563eb')
  })

  it('tints the background suggestions with the main colour', () => {
    const swatches = roleSuggestions('background', 'light', { primary: '#533afd' })
    const tinted = swatches.find((s) => s.name === 'Tinted')
    expect(tinted && tryCssColorToHex(tinted.hex)).toBeTruthy()
    expect(tinted?.hex).not.toBe('#ffffff')
  })
})
