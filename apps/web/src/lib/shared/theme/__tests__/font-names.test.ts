import { describe, expect, it } from 'vitest'
import { familyAsFileNames, fontDisplayName, isSymbolFace, oneFontFamily } from '../font-names'

describe('fontDisplayName', () => {
  it.each([
    ['MonzoSansText', 'Monzo Sans Text'],
    ['MonzoSansDisplay', 'Monzo Sans Display'],
    ['adobe-clean', 'Adobe Clean'],
    ['sohne-var', 'Sohne'],
    ['GTAmerica', 'GT America'],
    ['IBMPlexSans', 'IBM Plex Sans'],
    ['Plus_Jakarta_Sans', 'Plus Jakarta Sans'],
    ['Inter Variable', 'Inter'],
    ['Circular20', 'Circular20'],
    ['figmaSans', 'Figma Sans'],
    ['calSans', 'Cal Sans'],
  ])('reads %s as %s', (name, shown) => {
    expect(fontDisplayName(name)).toBe(shown)
  })

  // A stylesheet often names one weight's file, a build's hash or a web kit's
  // code as if it were the family.
  it.each([
    ['Source Sans Pro Regular', 'Source Sans Pro'],
    ['Flux Regular', 'Flux'],
    ['Johnston100 Light', 'Johnston100'],
    ['GT Walsheim Medium', 'GT Walsheim'],
    ['Helvetica Now Text Medium', 'Helvetica Now Text'],
    ['The Antiqua B ExtraBold', 'The Antiqua B'],
    ['twklausanne 400', 'Twklausanne'],
    ['Inter 5486e50ce5a4efdf', 'Inter'],
    ['Graphik 1bbd4a4c7a2fb472', 'Graphik'],
    ['Frutiger W01', 'Frutiger'],
    ['Avenir Next LTW02 Regular', 'Avenir Next LT'],
    ['Avenir Next LT W02 Bold', 'Avenir Next LT'],
  ])('reads %s as %s, without the weight, hash or kit code', (name, shown) => {
    expect(fontDisplayName(name)).toBe(shown)
  })

  it('keeps a word that is the family’s own', () => {
    expect(fontDisplayName('Archivo Black')).toBe('Archivo Black')
    expect(fontDisplayName('Monzo Sans Text')).toBe('Monzo Sans Text')
    expect(fontDisplayName('Roboto Slab')).toBe('Roboto Slab')
    expect(fontDisplayName('Decade')).toBe('Decade')
    expect(fontDisplayName('Regular')).toBe('Regular')
    expect(fontDisplayName('Bold 700')).toBe('Bold')
  })

  it('takes a name that already has spaces as written', () => {
    expect(fontDisplayName('Plus Jakarta Sans')).toBe('Plus Jakarta Sans')
    expect(fontDisplayName('SF Pro Display')).toBe('SF Pro Display')
    expect(fontDisplayName('DM Sans')).toBe('DM Sans')
    expect(fontDisplayName('McKinsey Sans-Serif')).toBe('McKinsey Sans-Serif')
  })
})

describe('familyAsFileNames', () => {
  it.each([
    // The same letters: the file's spacing and capitals.
    ['Abcgintonorthwind', 'ABC Ginto Northwind', 'ABC Ginto Northwind'],
    // A weight run into the stylesheet's name.
    ['northwindregular', 'Northwind', 'Northwind'],
    ['NWFBold', 'NWF', 'NWF'],
    // Words run together, with a word the stylesheet left out.
    ['NorthSansforNW', 'North Sans Nova for NW Var', 'North Sans Nova for NW'],
    ['HarborNow', 'Harbor Now Text', 'Harbor Now Text'],
  ])('%s, in a file named %s, is %s', (css, file, name) => {
    expect(familyAsFileNames(css, file)).toBe(name)
  })

  it.each([
    // Another family, a foundry's notice, or nothing at all.
    ['Haas', 'Haas Grot Text R Web'],
    ['NorthwindInter', 'Inter'],
    ['HarborSans', 'For webfont use only - Harbor Type'],
    ['Harbor Sans', '.'],
    ['Harbor Sans', null],
    // A name the stylesheet already writes well.
    ['Graphik', 'Graphik LCG Web'],
    ['Canva Sans', 'Canva Sans Sans'],
    // More than a weight left over: the stylesheet's words are part of the name.
    ['figmaSans', 'Figma VF'],
    // A file name that is itself run together.
    ['HarborSansUI', 'HarborSans4 UI'],
  ])('%s, in a file named %s, stays as the stylesheet names it', (css, file) => {
    expect(familyAsFileNames(css, file)).toBe(css)
  })
})

describe('isSymbolFace', () => {
  it('knows the faces a stack lists for emoji, flags, icons and currency signs', () => {
    for (const name of [
      'Twemoji Country Flags',
      'Apple Color Emoji',
      'Noto Color Emoji',
      'Segoe UI Symbol',
      'Font Awesome 6 Free',
      'FontAwesome',
      'Material Icons',
      'Material Symbols Outlined',
      'icomoon',
      'Saudi Riyal',
    ])
      expect(isSymbolFace(name)).toBe(true)
    for (const name of ['Gellix', 'Iconic Sans Text', 'Flagship Grotesk', 'Symbolset Pro Text'])
      expect(isSymbolFace(name)).toBe(false)
  })
})

describe('oneFontFamily', () => {
  it.each([
    ['Monzo Sans Display', 'Monzo Sans Text'],
    ['MonzoSansDisplay', 'MonzoSansText'],
    ['Charlie Display', 'Charlie Text'],
    ['Klarna Title', 'Klarna Text'],
    ['Graphik Semibold', 'Graphik'],
    ['Söhne Breit', 'Sohne-Breit'],
    ['Inter Display', 'Inter Variable'],
    ['Avenir Next LTW02 Regular', 'Avenir Next LT W02 Bold'],
  ])('%s and %s are one family', (a, b) => {
    expect(oneFontFamily(a, b)).toBe(true)
  })

  it.each([
    ['Plus Jakarta Sans', 'Inter'],
    ['Manrope', 'Inter'],
    ['Tiempos Headline', 'Sohne'],
    ['Playfair Display', 'DM Sans'],
  ])('%s and %s are two', (a, b) => {
    expect(oneFontFamily(a, b)).toBe(false)
  })

  it('a name that is only words for a cut is no family', () => {
    expect(oneFontFamily('Display', 'Text')).toBe(false)
    expect(oneFontFamily('Sans Serif', 'Serif')).toBe(false)
  })
})
