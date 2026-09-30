import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const routesDir = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Route modules the router loads: every file under src/routes except tests
 *  and `-`-prefixed files, which the route generator ignores. */
function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name.startsWith('-')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...routeFiles(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Exported component-shaped (PascalCase, not SCREAMING_CASE) bindings other
 *  than `Route`. */
function exportedComponents(source: string): string[] {
  const names = new Set<string>()
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Z][A-Za-z0-9_]*)/gm
  )) {
    names.add(m[1])
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const spec of m[1].split(',')) {
      const exported = spec
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (exported && /^[A-Z]/.test(exported)) names.add(exported)
    }
  }
  names.delete('Route')
  return [...names].filter((name) => /[a-z]/.test(name))
}

describe('route modules', () => {
  // The router's code splitter moves a route's component into a lazy chunk
  // only when the component is not exported. An exported component (or an
  // exported sub-component the page renders) stays in the route module,
  // which routeTree.gen imports eagerly, so it and everything it imports
  // ship in the entry bundle of every page, including the embeddable widget.
  // Components a test or another page needs belong in a component module.
  it('export no components, so the router can split every page out of the entry', () => {
    const offenders = routeFiles(routesDir)
      .map((file) => ({
        file: relative(routesDir, file),
        names: exportedComponents(readFileSync(file, 'utf8')),
      }))
      .filter((r) => r.names.length > 0)
      .map((r) => `${r.file}: ${r.names.join(', ')}`)
    expect(offenders).toEqual([])
  })
})
