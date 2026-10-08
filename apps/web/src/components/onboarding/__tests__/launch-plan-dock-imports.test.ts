/**
 * The launch plan dock sits in the admin rail on every admin page. Its count
 * comes from the launch checklist, the whole task catalogue with its copy, so
 * the dock loads the checklist only once a page has loaded the plan. A static
 * import anywhere on the dock's eager path would ship the catalogue in every
 * admin page's chunk.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CHECKLIST = '@/lib/shared/launch-checklist'

const read = (file: string) => readFileSync(resolve(SRC, file), 'utf8')

/** Specifiers of the imports that load code: `import type` is erased. */
function valueImportsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gms)].map(
    (match) => match[1]!
  )
}

/** A local specifier's source file, or null for a package. */
function localFile(specifier: string, from: string): string | null {
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? resolve(dirname(resolve(SRC, from)), specifier).slice(SRC.length + 1)
      : null
  if (!base) return null
  for (const file of [`${base}.ts`, `${base}.tsx`]) {
    try {
      readFileSync(resolve(SRC, file))
      return file
    } catch {
      // Try the next extension.
    }
  }
  return null
}

describe('launch plan dock imports', () => {
  const DOCK = 'components/onboarding/launch-plan-dock.tsx'

  it('is what the admin rail renders', () => {
    expect(valueImportsOf(read('components/admin/admin-sidebar.tsx'))).toContain(
      '@/components/onboarding/launch-plan-dock'
    )
  })

  it('loads the launch checklist when it counts, never with the rail', () => {
    const source = read(DOCK)
    expect(valueImportsOf(source)).not.toContain(CHECKLIST)
    // A loading import, not a `typeof import(...)` type.
    expect(source).toMatch(/(?<!typeof\s)import\('@\/lib\/shared\/launch-checklist'\)/)
  })

  it('reaches the checklist through none of its own local imports', () => {
    for (const specifier of valueImportsOf(read(DOCK))) {
      const file = localFile(specifier, DOCK)
      if (!file || !/^(components\/onboarding|lib\/shared)\//.test(file)) continue
      expect(valueImportsOf(read(file)), file).not.toContain(CHECKLIST)
    }
  })
})
