/**
 * The portal's page column is one utility, qb-page, not the same five
 * classes written out on every page.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../../..')

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full)
    return full.endsWith('.tsx') ? [full] : []
  })

describe('the page column', () => {
  it('is a utility with the page width and gutters', () => {
    const css = readFileSync(path.join(SRC, 'globals.css'), 'utf8')
    const rule = css.slice(css.indexOf('@utility qb-page {'))
    expect(rule).toMatch(
      /^@utility qb-page \{\s+margin-inline: auto;\s+width: 100%;\s+max-width: var\(--qb-page-max, 72rem\);\s+padding-inline: 1rem;/
    )
    expect(rule.slice(0, 300)).toContain('padding-inline: 1.5rem')
  })

  it('is never written out as classes in the portal', () => {
    const written = [
      ...files(path.join(SRC, 'components/public')),
      ...files(path.join(SRC, 'components/portal')),
      ...files(path.join(SRC, 'routes')),
    ].filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .some(
          (line) =>
            line.includes('max-w-[var(--qb-page-max,72rem)]') &&
            line.includes('mx-auto') &&
            line.includes('px-4') &&
            line.includes('sm:px-6') &&
            !line.includes('w-max')
        )
    )
    expect(written.map((file) => path.relative(SRC, file))).toEqual([])
  })
})
