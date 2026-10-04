/**
 * A focus outline that never draws. In Tailwind 4, `outline-none` sets
 * `--tw-outline-style: none`, and `outline-2` draws with
 * `outline-style: var(--tw-outline-style)`. So a class list with
 * `outline-none` and `focus-visible:outline-2` but no `outline-solid` shows no
 * outline at all on keyboard focus (the admin rail did exactly this).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { railControlClass } from '@/components/admin/rail-item'

const SRC = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') return []
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx?|jsx?)$/.test(name) && !name.endsWith('.gen.ts') ? [path] : []
  })
}

/** A string literal that hides the outline and later asks for a width-only one. */
function invisibleOutline(literal: string): boolean {
  const classes = literal.split(/\s+/)
  const hides = classes.includes('outline-none')
  const widthOnly = classes.some((c) => /^(focus|focus-visible):outline(-\d+)?$/.test(c))
  const styled = classes.some((c) => /:outline-(solid|dashed|dotted|double)$/.test(c))
  return hides && widthOnly && !styled
}

describe('focus outlines', () => {
  it('the admin rail draws its keyboard focus outline', () => {
    expect(invisibleOutline(railControlClass())).toBe(false)
    expect(invisibleOutline(railControlClass(true))).toBe(false)
  })

  it('no class list hides the outline and then asks for a width without a style', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) {
        if (invisibleOutline(match[2])) offenders.push(`${relative(SRC, file)}: ${match[2]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
