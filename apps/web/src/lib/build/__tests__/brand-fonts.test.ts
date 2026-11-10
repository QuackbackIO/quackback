/**
 * The font matcher's faces ship with the server build: the plugin writes each
 * file into `brand-fonts/` of the server output, and the matcher, running
 * from a chunk inside that output, finds and reads them there.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { brandFontAssets, brandFonts } from '../brand-fonts'
import { allFontFiles, FACES } from '../../server/domains/design/extract/fonts/faces'
import { findFontSource } from '../../server/domains/design/extract/fonts/files'
import { loadFont, renderText } from '../../server/domains/design/extract/fonts/woff'
import { readFileSync } from 'fs'

const FONTSOURCE = path.resolve(__dirname, '../../../../node_modules/@fontsource')
const tmp = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'brand-fonts-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** Runs the plugin's bundle hook as a build environment would, collecting what it emits. */
function emitted(environment: string) {
  const files: Array<{ fileName: string; source: Uint8Array }> = []
  const plugin = brandFonts(FONTSOURCE)
  const hook = plugin.generateBundle as unknown as (this: unknown) => void
  hook.call({
    environment: { name: environment },
    emitFile: (file: { fileName: string; source: Uint8Array }) => files.push(file),
  })
  return files
}

describe('brand fonts in the server build', () => {
  it('emits every face file into the server build only', () => {
    expect(emitted('client')).toHaveLength(0)
    expect(emitted('ssr')).toHaveLength(0)
    const files = emitted('nitro')
    expect(files).toHaveLength(allFontFiles().length)
    expect(files.every((f) => f.fileName.startsWith('brand-fonts/') && f.source.length > 1000)).toBe(true)
  })

  it('emits the Mona Sans and Hanken Grotesk latin files', () => {
    const names = emitted('nitro').map((f) => f.fileName)
    for (const pkg of ['mona-sans', 'hanken-grotesk'])
      for (const weight of [200, 400, 900])
        expect(names, `${pkg} ${weight}`).toContain(`brand-fonts/${pkg}-latin-${weight}-normal.woff`)
  })

  it('is found and read from a server chunk in the built output', () => {
    const server = path.join(tmp, '.output', 'server')
    for (const asset of brandFontAssets(FONTSOURCE)) {
      mkdirSync(path.dirname(path.join(server, asset.fileName)), { recursive: true })
      writeFileSync(path.join(server, asset.fileName), asset.source)
    }
    const chunks = path.join(server, '_chunks', 'lib')
    mkdirSync(chunks, { recursive: true })
    const found = findFontSource(chunks)!
    expect(found.root).toBe(path.join(server, 'brand-fonts'))
    for (const face of FACES) {
      const weight = face.weights.includes(400) ? 400 : face.weights[0]!
      const font = loadFont(new Uint8Array(readFileSync(found.file(face, weight))))
      expect(renderText(font, 32, 'Ag').mask.a.some((a) => a > 0.5), face.id).toBe(true)
    }
  })

  it('falls back to the packages in node_modules for the dev server and tests', () => {
    const found = findFontSource(path.resolve(__dirname))!
    expect(found.root).toBe(FONTSOURCE)
  })
})
