/**
 * Every design fixture reads as the same page from one format to the next:
 * the CSS it resolves to and the view a portal page is built from are kept
 * here, byte for byte (as a hash, so the snapshot stays small), as they were
 * before a format change, and a fixture stored in an older format must still
 * read to exactly that. The hashes were taken from the format 2 fixtures
 * before format 3; the fixtures are format 3 now, and each is also read as
 * format 2 stored it.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { designView } from '../design-view'
import { renderDesignCss, resolveDesign } from '../resolve'
import { readStoredDesign } from '../stored-design'
import { asFormat2 } from './format2'

const FX = join(import.meta.dirname, 'fixtures')
const files = [
  ...readdirSync(FX).filter((file) => file.endsWith('.json')),
  ...readdirSync(join(FX, 'no-overrides'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => `no-overrides/${file}`),
].sort()

/** The text's length and SHA-256: equal only when the text is, byte for byte. */
const print = (text: string) => `${text.length} ${createHash('sha256').update(text).digest('hex')}`

type Json = Record<string, unknown>

const FORMATS = { 3: (doc: Json) => doc, 2: asFormat2 }

const read = (file: string, format: keyof typeof FORMATS = 3) => {
  const doc = FORMATS[format](JSON.parse(readFileSync(join(FX, file), 'utf8')) as Json)
  const read = readStoredDesign(doc)
  if (!read) throw new Error(`${file} does not read`)
  return read
}

describe('design fixtures', () => {
  it('has fixtures', () => expect(files.length).toBeGreaterThanOrEqual(12))

  it.each(files)('%s reads with nothing set aside', (file) => {
    expect(read(file).dropped).toEqual([])
  })

  it.each(files)('%s resolves to the same CSS', (file) => {
    expect(print(renderDesignCss(resolveDesign(read(file).design)))).toMatchSnapshot()
  })

  it.each(files)('%s builds the same design view', (file) => {
    expect(print(JSON.stringify(designView(read(file).design, 7)))).toMatchSnapshot()
  })

  it.each(files)('%s is format 3, and reads the same as format 2 stored it', (file) => {
    const stored = JSON.parse(readFileSync(join(FX, file), 'utf8')) as Json
    expect(stored.version).toBe(3)
    const [now, before] = [read(file, 3), read(file, 2)]
    expect(before.dropped).toEqual([])
    expect(before.design).toEqual(now.design)
    expect(renderDesignCss(resolveDesign(before.design))).toBe(
      renderDesignCss(resolveDesign(now.design))
    )
    expect(JSON.stringify(designView(before.design, 7))).toBe(
      JSON.stringify(designView(now.design, 7))
    )
  })
})
