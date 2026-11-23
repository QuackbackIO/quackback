/**
 * Reading a font upload before anything is sent: each file's weight and
 * style from its name, the family from the first file, and what is wrong
 * with the set (the wrong kind of file, too large, too many, two files for
 * one weight and style, or a name the stylesheet cannot hold).
 */
import { describe, expect, it } from 'vitest'
import { fontUploadProblem, guessFace, guessFamily } from '../font-upload'

const file = (name: string, size = 1000) => ({ name, size })

describe('guessFace', () => {
  it('reads a weight and style from the file name', () => {
    expect(guessFace('Brand-Regular.woff2')).toEqual({ weight: 400, style: 'normal' })
    expect(guessFace('Brand-SemiBoldItalic.woff2')).toEqual({ weight: 600, style: 'italic' })
    expect(guessFace('brand_700.ttf')).toEqual({ weight: 700, style: 'normal' })
    expect(guessFace('Brand-Medium.otf')).toEqual({ weight: 500, style: 'normal' })
    expect(guessFace('Brand-Bold.woff')).toEqual({ weight: 700, style: 'normal' })
  })
})

describe('guessFamily', () => {
  it('takes the part before the weight', () => {
    expect(guessFamily('BrandSans-Regular.woff2')).toBe('Brand Sans')
    expect(guessFamily('acme_bold.ttf')).toBe('acme')
  })
})

describe('fontUploadProblem', () => {
  const face = (
    name: string,
    weight = 400,
    style: 'normal' | 'italic' = 'normal',
    size = 1000
  ) => ({
    file: file(name, size),
    weight,
    style,
  })

  it('is null for a set it can upload', () => {
    expect(
      fontUploadProblem('Brand Sans', [
        face('a.woff2'),
        face('b.woff2', 700),
        face('c.woff2', 400, 'italic'),
      ])
    ).toBeNull()
  })

  it('refuses a file that is not a font', () => {
    expect(fontUploadProblem('Brand', [face('logo.png')])).toBe(
      "logo.png isn't a WOFF2, WOFF, TTF or OTF file."
    )
  })

  it('refuses a file over its format limit', () => {
    expect(fontUploadProblem('Brand', [face('a.woff2', 400, 'normal', 500 * 1024)])).toBe(
      'a.woff2 is over 400 KB.'
    )
  })

  it('refuses more than six files', () => {
    const seven = Array.from({ length: 7 }, (_, i) => face(`f${i}.woff2`, (i + 1) * 100))
    expect(fontUploadProblem('Brand', seven)).toBe('Up to six files per font.')
  })

  it('refuses two files for the same weight and style', () => {
    expect(fontUploadProblem('Brand', [face('a.woff2'), face('b.woff2')])).toBe(
      'Two files are set to 400 upright. Give each file its own weight or style.'
    )
  })

  it('refuses a name the stylesheet cannot hold', () => {
    expect(fontUploadProblem('Brand"}', [face('a.woff2')])).toBe(
      'Use letters, numbers, spaces, dots, dashes and underscores in the name.'
    )
  })
})
