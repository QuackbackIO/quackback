import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { fontLicence, readFontFile } from '../font-file'
import { otf, ttf, woff, woff2 } from './font-fixture'

const require = createRequire(import.meta.url)
const fontsource = (file: string) =>
  new Uint8Array(readFileSync(require.resolve(`@fontsource/inter/files/${file}`)))

describe('readFontFile', () => {
  it.each([
    ['ttf', ttf],
    ['otf', otf],
    ['woff', woff],
    ['woff2', woff2],
  ] as const)('reads a %s file', (format, build) => {
    const facts = readFontFile(
      build({ family: 'Calibre', weight: 600, fsType: 8, licence: 'All rights reserved.' })
    )
    expect(facts).toMatchObject({
      format,
      family: 'Calibre',
      weight: 600,
      fsType: 8,
      licence: 'All rights reserved.',
      latin: true,
      glyphs: 120,
      weightRange: null,
    })
  })

  it('reads a real WOFF2 and WOFF file: Inter, regular and bold, under the Open Font License', () => {
    for (const [file, format, weight] of [
      ['inter-latin-400-normal.woff2', 'woff2', 400],
      ['inter-latin-700-normal.woff2', 'woff2', 700],
      ['inter-latin-400-normal.woff', 'woff', 400],
    ] as const) {
      const facts = readFontFile(fontsource(file))
      expect(facts).toMatchObject({ format, family: 'Inter', weight, latin: true, italic: false })
      expect(facts!.glyphs).toBeGreaterThan(100)
      expect(fontLicence(facts!)).toBe('open')
    }
  })

  it('reads a variable font’s weight axis', () => {
    expect(readFontFile(woff2({ axis: [100, 900] }))?.weightRange).toEqual([100, 900])
  })

  it('says when a file lacks the Latin letters', () => {
    expect(readFontFile(woff2({ ranges: [[0x30, 0x39]] }))?.latin).toBe(false)
    expect(readFontFile(fontsource('inter-cyrillic-400-normal.woff2'))?.latin).toBe(false)
  })

  it('reads anything that is not a font, or is cut short, as null', () => {
    expect(readFontFile(new Uint8Array())).toBeNull()
    expect(readFontFile(new TextEncoder().encode('<!doctype html><html></html>'))).toBeNull()
    for (const build of [ttf, otf, woff, woff2]) {
      const whole = build()
      for (const cut of [10, 30, 60, whole.length - 20])
        expect(() => readFontFile(whole.subarray(0, cut))).not.toThrow()
      expect(readFontFile(whole.subarray(0, 30))).toBeNull()
    }
  })

  it('never unpacks a file that claims to be huge', () => {
    const bomb = Buffer.from(woff())
    // The first table now claims four gigabytes unpacked.
    bomb.writeUInt32BE(0xffffffff, 44 + 12)
    expect(readFontFile(bomb)).toBeNull()
  })
})

describe('fontLicence', () => {
  it('is restricted when the maker set the restricted-licence embedding bit', () => {
    expect(fontLicence(readFontFile(woff2({ fsType: 0x0002 }))!)).toBe('restricted')
    expect(fontLicence(readFontFile(ttf({ fsType: 0x0002 }))!)).toBe('restricted')
  })

  it('is restricted even when the licence text names an open licence', () => {
    const facts = readFontFile(woff({ fsType: 0x0002, licence: 'SIL Open Font License 1.1' }))!
    expect(fontLicence(facts)).toBe('restricted')
  })

  it('is open under the SIL Open Font License or Apache, by text or by URL', () => {
    for (const font of [
      { licence: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.' },
      { licenceUrl: 'https://scripts.sil.org/OFL' },
      { licenceUrl: 'https://openfontlicense.org' },
      { licence: 'Licensed under the Apache License, Version 2.0' },
      { licenceUrl: 'http://www.apache.org/licenses/LICENSE-2.0' },
    ])
      expect(fontLicence(readFontFile(woff2(font))!)).toBe('open')
  })

  it('is commercial otherwise: editable or installable embedding, any other licence or none', () => {
    expect(fontLicence(readFontFile(woff2({ fsType: 8 }))!)).toBe('commercial')
    expect(fontLicence(readFontFile(woff2({ fsType: 0 }))!)).toBe('commercial')
    expect(fontLicence(readFontFile(woff2({ licence: 'Klim Type Foundry web licence' }))!)).toBe(
      'commercial'
    )
  })
})
