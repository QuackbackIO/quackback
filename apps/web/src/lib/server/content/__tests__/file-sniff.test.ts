import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { sniffFile, isRefusedFromUnverifiedSender } from '../file-sniff'

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = []
  for (const p of parts) {
    if (typeof p === 'string') for (const c of p) out.push(c.charCodeAt(0))
    else out.push(...p)
  }
  // Pad so length-gated checks have room.
  while (out.length < 64) out.push(0x20)
  return new Uint8Array(out)
}

const zip = (entries: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])))

describe('sniffFile: media', () => {
  it('detects raster images whatever the name says', () => {
    const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffFile(png, 'report.pdf')).toMatchObject({
      contentType: 'image/png',
      family: 'image',
    })
  })
  it('separates HEIC, audio and video ISO containers by brand', () => {
    expect(sniffFile(bytes([0, 0, 0, 24], 'ftypheic'), 'a.heic').contentType).toBe('image/heic')
    expect(sniffFile(bytes([0, 0, 0, 24], 'ftypM4A '), 'a.m4a')).toMatchObject({
      contentType: 'audio/mp4',
      family: 'audio',
    })
    expect(sniffFile(bytes([0, 0, 0, 24], 'ftypisom'), 'a.mp4')).toMatchObject({
      contentType: 'video/mp4',
      family: 'video',
    })
    expect(sniffFile(bytes([0, 0, 0, 24], 'ftypqt  '), 'a.mov').contentType).toBe('video/quicktime')
  })
  it('detects audio signatures', () => {
    expect(sniffFile(bytes('ID3', [3, 0]), 'a.mp3').contentType).toBe('audio/mpeg')
    expect(sniffFile(bytes([0xff, 0xfb, 0x90]), 'a.mp3').contentType).toBe('audio/mpeg')
    expect(sniffFile(bytes('RIFF', [0, 0, 0, 0], 'WAVE'), 'a.wav').contentType).toBe('audio/wav')
    expect(sniffFile(bytes('OggS'), 'a.ogg').contentType).toBe('audio/ogg')
    expect(sniffFile(bytes('fLaC'), 'a.flac').contentType).toBe('audio/flac')
  })
  it('detects webm', () => {
    expect(sniffFile(bytes([0x1a, 0x45, 0xdf, 0xa3]), 'a.webm').contentType).toBe('video/webm')
  })
})

describe('sniffFile: documents', () => {
  it('detects PDF, including a header after leading junk', () => {
    expect(sniffFile(bytes('%PDF-1.7'), 'x').family).toBe('pdf')
    expect(sniffFile(bytes('\r\n\r\n%PDF-1.4'), 'x').contentType).toBe('application/pdf')
  })
  it('tells OOXML packages apart by their parts, not their names', () => {
    const docx = zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': '<w/>' })
    expect(sniffFile(docx, 'named.zip')).toMatchObject({ family: 'document', macro: false })
    const xlsx = zip({ '[Content_Types].xml': '<x/>', 'xl/workbook.xml': '<w/>' })
    expect(sniffFile(xlsx, 'a.docx').family).toBe('spreadsheet')
    const pptx = zip({ '[Content_Types].xml': '<x/>', 'ppt/presentation.xml': '<p/>' })
    expect(sniffFile(pptx, 'a.pptx').family).toBe('presentation')
  })
  it('flags an OOXML package that carries a VBA project', () => {
    const docm = zip({ 'word/document.xml': '<w/>', 'word/vbaProject.bin': 'vba' })
    expect(sniffFile(docm, 'a.docx')).toMatchObject({
      contentType: 'application/vnd.ms-word.document.macroEnabled.12',
      macro: true,
    })
  })
  it('reads the OpenDocument mimetype entry', () => {
    const odt = zipSync(
      { mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }] },
      {}
    )
    expect(sniffFile(odt, 'a.odt')).toMatchObject({
      contentType: 'application/vnd.oasis.opendocument.text',
      family: 'document',
    })
  })
  it('names legacy OLE2 office files from the extension, and only those', () => {
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(sniffFile(ole, 'a.xls').family).toBe('spreadsheet')
    expect(sniffFile(ole, 'a.doc').family).toBe('document')
    expect(sniffFile(ole, 'a.txt')).toMatchObject({ family: 'other' })
  })
  it('detects RTF', () => {
    expect(sniffFile(bytes('{\\rtf1\\ansi'), 'a.rtf').family).toBe('document')
  })
  it('treats a plain zip as an archive', () => {
    expect(sniffFile(zip({ 'readme.md': '# hi' }), 'a.zip')).toMatchObject({
      contentType: 'application/zip',
      family: 'archive',
    })
  })
  it('does not trust a corrupt zip to be anything', () => {
    expect(sniffFile(bytes([0x50, 0x4b, 0x03, 0x04], 'garbage'), 'a.docx').family).toBe('archive')
  })
})

describe('sniffFile: text', () => {
  const text = (s: string) => new TextEncoder().encode(s)
  it('types valid UTF-8 text by extension', () => {
    expect(sniffFile(text('a,b\n1,2\n'), 'rows.csv')).toMatchObject({
      contentType: 'text/csv',
      family: 'csv',
    })
    expect(sniffFile(text('{"a":1}'), 'data.json').family).toBe('code')
    expect(sniffFile(text('INFO started'), 'app.log')).toMatchObject({
      contentType: 'text/plain',
      family: 'text',
    })
  })
  it('recognises JSON and XML without an extension', () => {
    expect(sniffFile(text('[1,2,3]'), 'noext').contentType).toBe('application/json')
    expect(sniffFile(text('<?xml version="1.0"?><a/>'), 'noext').contentType).toBe(
      'application/xml'
    )
  })
  it('keeps SVG an image only when the text is SVG', () => {
    expect(
      sniffFile(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg')
    ).toMatchObject({ contentType: 'image/svg+xml', family: 'image' })
    expect(sniffFile(text('just words'), 'a.svg').family).toBe('text')
  })
  it('never calls HTML anything that renders', () => {
    expect(sniffFile(text('<html><script>x</script></html>'), 'page.html')).toMatchObject({
      contentType: 'text/html',
      family: 'code',
    })
  })
  it('does not call binary data text', () => {
    expect(sniffFile(new Uint8Array([0x41, 0x00, 0x42, 0x43]), 'a.txt').family).toBe('other')
    expect(sniffFile(new Uint8Array([0xc3, 0x28, 0x41, 0x41]), 'a.txt').family).toBe('other')
  })
  it('accepts text whose 8 KB window ends inside a multi-byte character', () => {
    const s = 'a'.repeat(8191) + 'é' + 'tail'
    expect(sniffFile(text(s), 'a.txt').family).toBe('text')
  })
})

describe('executables', () => {
  it('flags native executables and scripts from their bytes', () => {
    expect(sniffFile(bytes('MZ', [0x90, 0]), 'notes.pdf').executable).toBe(true)
    expect(sniffFile(bytes([0x7f, 0x45, 0x4c, 0x46]), 'a.png').executable).toBe(true)
    expect(sniffFile(bytes([0xcf, 0xfa, 0xed, 0xfe]), 'a').executable).toBe(true)
    expect(sniffFile(bytes([0xca, 0xfe, 0xba, 0xbe]), 'a').executable).toBe(true)
    expect(sniffFile(new TextEncoder().encode('#!/bin/sh\nrm -rf /'), 'a.txt').executable).toBe(
      true
    )
  })
  it('flags Java and Android packages hiding in a zip', () => {
    const jar = zip({ 'META-INF/MANIFEST.MF': 'Main-Class: A', 'A.class': 'x' })
    expect(sniffFile(jar, 'a.zip').executable).toBe(true)
    const apk = zip({ 'AndroidManifest.xml': 'x', 'classes.dex': 'x' })
    expect(sniffFile(apk, 'a.zip').executable).toBe(true)
  })
  it('does not flag ordinary files', () => {
    expect(sniffFile(bytes('%PDF-1.7'), 'a.pdf').executable).toBe(false)
    expect(sniffFile(new TextEncoder().encode('# heading'), 'a.md').executable).toBe(false)
  })
})

describe('isRefusedFromUnverifiedSender', () => {
  it('refuses on the bytes or the name', () => {
    const exe = sniffFile(bytes('MZ'), 'invoice.pdf')
    expect(isRefusedFromUnverifiedSender(exe, 'invoice.pdf')).toBe(true)
    const renamed = sniffFile(new TextEncoder().encode('console.log(1)'), 'payload.js')
    expect(isRefusedFromUnverifiedSender(renamed, 'payload.js')).toBe(true)
  })
  it('allows ordinary documents', () => {
    const pdf = sniffFile(bytes('%PDF-1.7'), 'a.pdf')
    expect(isRefusedFromUnverifiedSender(pdf, 'a.pdf')).toBe(false)
  })
})
