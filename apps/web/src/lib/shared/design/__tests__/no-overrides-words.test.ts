/**
 * Words written before headings, alignment and colours draw exactly as they
 * did: the same HTML (`*.base.html`, written by the renderer before them).
 * The fixtures are the bench designs' Welcome bodies and a corpus of
 * the shapes older words take.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateContentHTML } from '@/lib/shared/content-html'

const FX = join(import.meta.dirname, 'fixtures', 'rich-words')
const bodies = readdirSync(FX)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))

describe('words with none of the new marks', () => {
  it('has fixtures', () => expect(bodies.length).toBeGreaterThanOrEqual(5))

  it.each(bodies)('%s draws the same HTML as before', (name) => {
    const doc = JSON.parse(readFileSync(join(FX, `${name}.json`), 'utf8'))
    const before = readFileSync(join(FX, `${name}.base.html`), 'utf8').trimEnd()
    expect(generateContentHTML(doc)).toBe(before)
  })
})
