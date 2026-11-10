/**
 * The portal's own UI never sets text under 12px: no arbitrary size below it
 * (text-[11px], text-[0.65rem]) in the portal's components and routes. The
 * design's own sizes are held to the same floor by its checks (checks.ts).
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dirname, '../../..')
const PORTAL = [
  'components/public',
  'components/portal',
  'components/help-center',
  'components/auth',
  'routes/_portal',
  'routes/_portal.tsx',
  'routes/_portal.b.$slug.posts.$postId.tsx',
]

function files(path: string): string[] {
  const full = join(SRC, path)
  if (statSync(full).isFile()) return [full]
  return readdirSync(full).flatMap((entry) =>
    entry === '__tests__' ? [] : files(join(path, entry))
  )
}

/** Arbitrary text sizes in px or rem, as Tailwind classes write them. */
const SIZE = /\btext-\[(\d*\.?\d+)(px|rem)\]/g

describe('portal type', () => {
  it('sets no text under 12px', () => {
    const small: string[] = []
    for (const file of PORTAL.flatMap(files).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(file, 'utf8')
      for (const [match, size, unit] of source.matchAll(SIZE)) {
        const px = Number(size) * (unit === 'rem' ? 16 : 1)
        if (px < 12) small.push(`${relative(SRC, file)}: ${match}`)
      }
    }
    expect(small).toEqual([])
  })
})
