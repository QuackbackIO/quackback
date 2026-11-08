/**
 * Where the value a row stores is not what the canvas draws, the row says
 * what is drawn: a headline's size is its widest, smaller on a phone, and a
 * text colour is moved until it reads.
 */
import { describe, expect, it } from 'vitest'
import { cssColourHex, inUseNote } from '../in-use'

describe('cssColourHex', () => {
  it('reads the colours a browser computes as hex', () => {
    expect(cssColourHex('rgb(143, 143, 143)')).toBe('#8f8f8f')
    expect(cssColourHex('rgba(143, 143, 143, 1)')).toBe('#8f8f8f')
    expect(cssColourHex('rgb(143 143 143)')).toBe('#8f8f8f')
    expect(cssColourHex('#FEFEFE')).toBe('#fefefe')
    expect(cssColourHex('color(srgb 1 0 0.5)')).toBe('#ff0080')
    expect(cssColourHex('oklch(1 0 0)')).toBe('#ffffff')
  })

  it('reads nothing see-through, which has no one colour', () => {
    expect(cssColourHex('rgba(0, 0, 0, 0)')).toBeNull()
    expect(cssColourHex('rgba(10, 10, 10, 0.5)')).toBeNull()
    expect(cssColourHex('rgb(10 10 10 / 50%)')).toBeNull()
    expect(cssColourHex('transparent')).toBeNull()
    expect(cssColourHex('')).toBeNull()
  })
})

describe('inUseNote', () => {
  const at = { size: 'phone' as const, colourHex: (c: string) => cssColourHex(c) }

  it('says a size is the widest, and the size this screen draws', () => {
    expect(inUseNote({ prop: 'size', stored: 56, drawn: 30.8, ...at })).toEqual({
      text: '56 max · 31 on this phone',
      value: 31,
    })
    expect(
      inUseNote({ prop: 'size', stored: 56, drawn: 49.78, ...at, size: 'desktop' })?.text
    ).toBe('56 max · 50 at this width')
  })

  it('says nothing where the canvas draws what is stored, to the pixel', () => {
    expect(inUseNote({ prop: 'size', stored: 18, drawn: 18.2, ...at })).toBeNull()
    expect(inUseNote({ prop: 'radius', stored: 8, drawn: 8, ...at })).toBeNull()
    expect(inUseNote({ prop: 'color', stored: '#0a0a0a', drawn: '#0a0a0a', ...at })).toBeNull()
  })

  it('says what a number is drawn as where it differs', () => {
    expect(inUseNote({ prop: 'radius', stored: 999, drawn: 18, ...at })).toEqual({
      text: 'Shown as 18',
      value: 18,
    })
  })

  it('says a text colour is moved so it reads, and offers the colour in use', () => {
    expect(inUseNote({ prop: 'color', stored: '#FEFEFE', drawn: '#8f8f8f', ...at })).toEqual({
      text: 'Shown as #8F8F8F so it reads',
      value: '#8f8f8f',
    })
    expect(inUseNote({ prop: 'background', stored: '#ffffff', drawn: '#f4f4f4', ...at })).toEqual({
      text: 'Shown as #F4F4F4',
      value: '#f4f4f4',
    })
  })

  it('reads a colour named by its role as the role’s colour', () => {
    const colourHex = (c: string) => (c === 'ink' ? '#0a0a0a' : cssColourHex(c))
    expect(
      inUseNote({ prop: 'color', stored: 'ink', drawn: '#0a0a0a', size: 'phone', colourHex })
    ).toBeNull()
  })

  it('says nothing it cannot compare: nothing stored, nothing drawn, a gradient', () => {
    expect(inUseNote({ prop: 'size', stored: undefined, drawn: 30, ...at })).toBeNull()
    expect(inUseNote({ prop: 'size', stored: 30, drawn: undefined, ...at })).toBeNull()
    expect(
      inUseNote({
        prop: 'background',
        stored: { from: 'accent', to: 'support' },
        drawn: '#fff',
        ...at,
      })
    ).toBeNull()
    expect(inUseNote({ prop: 'shadow', stored: 'soft', drawn: 'none', ...at })).toBeNull()
  })
})
