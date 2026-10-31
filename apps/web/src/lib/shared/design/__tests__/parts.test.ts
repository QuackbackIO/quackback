/**
 * The parts contract. A workspace's CSS styles the portal by part name, so a
 * part may not disappear: each listed part stays marked in the files that
 * draw it, sets the states it lists, and reads tokens the design declares.
 * A part renamed keeps its old name as an alias.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PART_ALIASES, PORTAL_PARTS, isPartName } from '../parts'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign } from '../schema'

const SRC = join(import.meta.dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(SRC, file), 'utf8')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('the portal’s parts', () => {
  it.each(PORTAL_PARTS.map((part) => [part.name, part] as const))(
    '%s is marked where it is drawn, with its states',
    (name, part) => {
      for (const file of part.files) {
        const source = read(file)
        expect(source, `${file} marks ${name}`).toContain(`data-qb-part="${name}"`)
      }
      for (const state of part.states) {
        const sets = part.files.some((file) =>
          new RegExp(`data-state=\\{[^}]*'${state}'`).test(read(file))
        )
        expect(sets, `${name} sets ${state}`).toBe(true)
      }
    }
  )

  it('marks no part the manifest does not list', () => {
    const marked = new Set<string>()
    for (const file of sourceFiles(join(SRC, 'components'))) {
      for (const [, name] of readFileSync(file, 'utf8').matchAll(/data-qb-part="([a-z-]+)"/g)) {
        marked.add(name!)
      }
    }
    expect([...marked].filter((name) => !isPartName(name))).toEqual([])
    expect([...marked].sort()).toEqual(PORTAL_PARTS.map((part) => part.name).sort())
  })

  it('documents only tokens the design declares', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    const missing = PORTAL_PARTS.flatMap((part) =>
      part.tokens
        .filter((token) => !css.includes(`${token}:`))
        .map((token) => `${part.name} ${token}`)
    )
    expect(missing).toEqual([])
  })

  it('points each alias at a part that exists', () => {
    for (const [, to] of Object.entries(PART_ALIASES)) {
      expect(PORTAL_PARTS.some((part) => part.name === to)).toBe(true)
    }
  })
})
