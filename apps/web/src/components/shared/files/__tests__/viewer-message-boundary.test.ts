/**
 * Guard: the viewer's own strings (`VIEWER_MESSAGE_PREFIXES`) are left out of
 * the catalog every page seeds and load when the viewer opens. That holds only
 * while the code using them is itself loaded with the viewer, so:
 *   - only the viewer's modules (the shell, its skeleton, the engines) use them;
 *   - nothing outside those modules imports one of them statically, which would
 *     put viewer strings on a page that has not loaded them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { VIEWER_MESSAGE_PREFIXES } from '@/lib/shared/i18n'

const SRC = resolve(__dirname, '../../../..')

const VIEWER_MODULE =
  /^components\/shared\/files\/(file-viewer\.tsx|viewer-skeleton\.tsx|viewers\/)/

/**
 * Whether a source names a message id under one of the viewer's prefixes: a
 * quoted prefix followed by the rest of an id (the prefix list itself is not
 * a use).
 */
function usesViewerMessage(source: string): boolean {
  for (const prefix of VIEWER_MESSAGE_PREFIXES) {
    for (const quote of ["'", '"', '`']) {
      const needle = quote + prefix
      for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
        if (/[A-Za-z]/.test(source.charAt(at + needle.length))) return true
      }
    }
  }
  return false
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'locales') sourceFiles(path, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'routeTree.gen.ts') {
      out.push(path)
    }
  }
  return out
}

const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm

function resolveImport(from: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier)
  else return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const files = sourceFiles(SRC)
const rel = (path: string) => relative(SRC, path)
const users = files.filter((path) => usesViewerMessage(readFileSync(path, 'utf8')))

describe('viewer strings stay with the viewer', () => {
  it('are used only by modules loaded with the viewer', () => {
    expect(users.length).toBeGreaterThan(0)
    expect(users.map(rel).filter((path) => !VIEWER_MODULE.test(path))).toEqual([])
  })

  it('come from modules nothing else imports statically', () => {
    const userSet = new Set(users)
    const leaks: string[] = []
    for (const importer of files) {
      if (VIEWER_MODULE.test(rel(importer))) continue
      const source = readFileSync(importer, 'utf8')
      for (const match of source.matchAll(STATIC_IMPORT)) {
        const target = resolveImport(importer, match[1]!)
        if (target && userSet.has(target)) leaks.push(`${rel(importer)} -> ${rel(target)}`)
      }
    }
    expect(leaks).toEqual([])
  })
})
