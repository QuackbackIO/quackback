// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { isSheetMessage } from '@/lib/shared/i18n'

// Admin pages seed their catalog without the setup sheets' strings; the sheets
// load them as they open (see SheetMessages). A string a page renders outside
// a sheet would show its English default in every other language, so only the
// sheets themselves may name one. Server code formats with the whole catalog.
const APP_SRC = fileURLToPath(new URL('../../../', import.meta.url))
const SHEETS = new Set([
  'components/onboarding/try-messenger-sheet.tsx',
  'components/onboarding/install-messenger-sheet.tsx',
  'components/onboarding/invite-team-sheet.tsx',
])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__mocks__' || entry === 'locales') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function messageIds(source: string): string[] {
  const ids: string[] = []
  for (const m of source.matchAll(/['"`](onboarding\.(?:live|test)\.[\w.]*)/g)) ids.push(m[1])
  return ids
}

describe('setup sheet strings', () => {
  it('are named only by the sheets that load them', () => {
    const outside: string[] = []
    for (const file of walk(APP_SRC)) {
      const path = relative(APP_SRC, file)
      if (SHEETS.has(path) || path === 'lib/shared/i18n.ts' || path.startsWith('lib/server/'))
        continue
      for (const id of messageIds(readFileSync(file, 'utf8'))) {
        if (isSheetMessage(id)) outside.push(`${path}: ${id}`)
      }
    }
    expect(outside).toEqual([])
  })
})
