/**
 * The single sign-on plan notice uses the plan-limits words only.
 *
 * Scans every string literal and JSX text in the notice module, so a new
 * sentence added later is checked too, not just the ones rendered elsewhere.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const BANNED = [
  /\bgrace\b/i,
  /\bfrozen\b/i,
  /\bheld\b/i,
  /\bswitch/i,
  /\benforce/i,
  /\bextras\b/i,
  /current plan/i,
  /on your plan/i,
  /choose a plan/i,
  /keep pro/i,
  /\ban owner\b/i,
  /—/,
  /!/,
]

function userFacingStrings(path: string): string[] {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(import|\*|\/\/|\/\*\*)/.test(line))
    .join('\n')
  const found: string[] = []
  for (const m of source.matchAll(/'([^'\\\n]*)'|`([^`]*)`|>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (/\s/.test(text)) found.push(text)
  }
  return found
}

describe('single sign-on plan notice copy', () => {
  const strings = userFacingStrings('../sso-upgrade-notice.tsx')

  it('finds the sentences it is meant to check', () => {
    expect(strings).toEqual(
      expect.arrayContaining([
        'It comes back when you upgrade.',
        'Ask someone who manages billing to upgrade.',
      ])
    )
    expect(strings.some((s) => s.includes('Single sign-on is paused on the'))).toBe(true)
  })

  it.each(BANNED.map((re) => [re.source, re] as const))('never says %s', (_, re) => {
    expect(strings.filter((s) => re.test(s))).toEqual([])
  })
})
