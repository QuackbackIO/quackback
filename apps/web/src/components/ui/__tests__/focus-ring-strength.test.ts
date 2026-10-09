import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const uiDir = join(__dirname, '..')
const sources = readdirSync(uiDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, text: readFileSync(join(uiDir, f), 'utf8') }))

// A ring with an alpha under 100 measures about 2:1 against the page, below the 3:1 a
// focus indicator needs. `ring-ring/<n>` is the neutral token, so it is faded everywhere it
// appears; any other colour is faded only when a focus variant applies it.
const fadedRingToken = /(?<![\w-])ring-ring\/(\d+)/g
const fadedFocusRing =
  /(?<![\w-])(?:[\w[\]-]+:)*focus(?:-visible|-within)?:(?:[\w[\]-]+:)*ring-(?!offset)[a-z0-9-]+\/(\d+)/g

function fadedRings(text: string): string[] {
  const found: string[] = []
  for (const re of [fadedRingToken, fadedFocusRing]) {
    for (const m of text.matchAll(re)) {
      if (Number(m[1]) < 100) found.push(m[0])
    }
  }
  return found
}

describe('focus rings in components/ui', () => {
  it('detects a faded ring', () => {
    expect(fadedRings('focus-visible:ring-2 focus-visible:ring-ring/40')).toEqual([
      'ring-ring/40',
      'focus-visible:ring-ring/40',
    ])
    expect(fadedRings('focus-visible:ring-zinc-400/50')).toHaveLength(1)
    expect(fadedRings('focus-visible:ring-ring aria-invalid:ring-destructive/20')).toEqual([])
  })

  it.each(sources.map((s) => [s.file, s.text] as const))(
    '%s draws no faded focus ring',
    (_file, text) => {
      expect(fadedRings(text)).toEqual([])
    }
  )
})
