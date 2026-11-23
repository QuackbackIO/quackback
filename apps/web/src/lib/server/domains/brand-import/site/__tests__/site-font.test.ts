import { describe, expect, it } from 'vitest'
import { classifySiteFont } from '../site-font'
import { ttf, woff2 } from './font-fixture'

const file = (bytes: Uint8Array, weight = 400, url = 'https://northwind.com/fonts/c.woff2') => ({
  url,
  weight,
  bytes,
})

describe('classifySiteFont', () => {
  it('copies a self-hosted commercial font, to be confirmed', () => {
    const regular = woff2({ licence: 'Klim web licence' })
    const bold = woff2({ weight: 700 })
    expect(
      classifySiteFont({ family: 'Calibre', files: [file(regular), file(bold, 700)] })
    ).toEqual({
      family: 'Calibre',
      licence: 'commercial',
      files: [
        { bytes: regular, format: 'woff2', weight: 400 },
        { bytes: bold, format: 'woff2', weight: 700 },
      ],
    })
  })

  it('copies an open-licence font with no confirmation needed, only when every file is open', () => {
    const open = { licenceUrl: 'https://scripts.sil.org/OFL' }
    expect(
      classifySiteFont({
        family: 'Figtree',
        files: [file(woff2(open)), file(woff2({ ...open, weight: 700 }), 700)],
      })
    ).toMatchObject({ licence: 'open' })
    expect(
      classifySiteFont({
        family: 'Figtree',
        files: [file(woff2(open)), file(woff2({ weight: 700 }), 700)],
      })
    ).toMatchObject({ licence: 'commercial' })
  })

  it('spells the family as its own file does when they are the same letters', () => {
    // A stylesheet often runs the words together; the file's name table has them apart.
    expect(
      classifySiteFont({
        family: 'Abcgintonorthwind',
        files: [file(woff2({ family: 'ABC Ginto Northwind' }))],
      })
    ).toMatchObject({ family: 'ABC Ginto Northwind' })
    expect(
      classifySiteFont({
        family: 'northwindsans 400',
        files: [file(woff2({ family: 'Northwind Sans' }))],
      })
    ).toMatchObject({ family: 'Northwind Sans' })
  })

  it('takes the file’s name where the stylesheet ran a weight or the words into it, and says what the stylesheet calls it', () => {
    expect(
      classifySiteFont({
        family: 'northwindregular',
        files: [file(woff2({ family: 'Northwind' }))],
      })
    ).toMatchObject({ family: 'Northwind', named: 'northwindregular' })
    expect(
      classifySiteFont({
        family: 'NorthSansforNW',
        files: [file(woff2({ family: 'North Sans Nova for NW Var' }))],
      })
    ).toMatchObject({ family: 'North Sans Nova for NW', named: 'NorthSansforNW' })
    // A font that was not copied is still named by its file.
    expect(
      classifySiteFont({
        family: 'northwindregular',
        files: [file(woff2({ family: 'Northwind', fsType: 0x0002 }))],
      })
    ).toEqual({ family: 'Northwind', named: 'northwindregular', notCopied: 'restricted' })
  })

  it('keeps the stylesheet’s name when the file names another family, or none', () => {
    expect(
      classifySiteFont({ family: 'Haas', files: [file(woff2({ family: 'Haas Grot Text R Web' }))] })
    ).toMatchObject({ family: 'Haas' })
    expect(
      classifySiteFont({ family: 'Northwind Sans', files: [file(woff2({ family: '.' }))] })
    ).toMatchObject({ family: 'Northwind Sans' })
  })

  it('keeps a variable font’s weights', () => {
    const bytes = woff2({ axis: [100, 900] })
    expect(
      classifySiteFont({
        family: 'Sohne',
        files: [{ url: 'https://northwind.com/v.woff2', weight: 100, weightTo: 900, bytes }],
      })
    ).toMatchObject({ files: [{ format: 'woff2', weight: 100, weightTo: 900 }] })
  })

  it('reads a variable font’s weights from the file when the site declares only one', () => {
    const bytes = woff2({ axis: [1, 1000] })
    expect(classifySiteFont({ family: 'Sohne', files: [file(bytes)] })).toMatchObject({
      files: [{ weight: 100, weightTo: 900 }],
    })
  })

  it('never copies from a font service, whoever says so', () => {
    expect(classifySiteFont({ family: 'Calibre', service: true, files: [] })).toEqual({
      family: 'Calibre',
      notCopied: 'service',
    })
    expect(
      classifySiteFont({
        family: 'Calibre',
        files: [file(woff2(), 400, 'https://use.typekit.net/af/1/l')],
      })
    ).toEqual({ family: 'Calibre', notCopied: 'service' })
  })

  it('never copies a font whose file sets the restricted-licence bit, on any of its files', () => {
    expect(
      classifySiteFont({
        family: 'Calibre',
        files: [file(woff2()), file(ttf({ fsType: 0x0002, weight: 700 }), 700)],
      })
    ).toEqual({ family: 'Calibre', notCopied: 'restricted' })
  })

  it('does not copy a family whose regular file is a subset too small to set words in', () => {
    expect(
      classifySiteFont({ family: 'Calibre', files: [file(woff2({ ranges: [[0x30, 0x39]] }))] })
    ).toEqual({ family: 'Calibre', notCopied: 'subset' })
  })

  it('does not copy a file over the size cap', () => {
    expect(
      classifySiteFont({ family: 'Calibre', files: [file(ttf({ padding: 420 * 1024 }))] })
    ).toEqual({ family: 'Calibre', notCopied: 'too-large' })
    expect(classifySiteFont({ family: 'Calibre', tooLarge: true, files: [] })).toEqual({
      family: 'Calibre',
      notCopied: 'too-large',
    })
  })

  it('copies the regular alone when the bold cannot be used', () => {
    const regular = woff2()
    const result = classifySiteFont({
      family: 'Calibre',
      files: [file(regular), file(new TextEncoder().encode('<html>'), 700)],
    })
    expect(result).toEqual({
      family: 'Calibre',
      licence: 'commercial',
      files: [{ bytes: regular, format: 'woff2', weight: 400 }],
    })
  })

  it('says nothing when no file could be read at all', () => {
    expect(classifySiteFont({ family: 'Calibre', files: [] })).toBeUndefined()
    expect(
      classifySiteFont({ family: 'Calibre', files: [file(new TextEncoder().encode('nope'))] })
    ).toBeUndefined()
  })

  it('gives the family a name a stylesheet can hold', () => {
    expect(classifySiteFont({ family: 'sohne-var', files: [file(woff2())] })).toMatchObject({
      family: 'sohne-var',
    })
    expect(classifySiteFont({ family: 'Bad"};Name', files: [file(woff2())] })).toMatchObject({
      family: 'BadName',
    })
    expect(classifySiteFont({ family: '"};', files: [file(woff2())] })).toBeUndefined()
  })
})
