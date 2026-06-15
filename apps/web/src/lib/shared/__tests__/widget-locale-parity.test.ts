import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'

// The widget SDK is a standalone published package, so it can't import the app's
// SUPPORTED_LOCALES and keeps its own WIDGET_LOCALES list. This test is the one
// place that sees both and enforces SUPPORTED_LOCALES as the source of truth: if
// a locale is added/removed in the app, the widget list must follow.
//
// We read the widget source as text rather than importing it: apps/web is a
// composite TS project (a relative import trips TS6307) and the package resolves
// to its built dist, so neither route reaches the source cleanly — and a
// text read needs no cross-package dependency.
function readWidgetLocales(): string[] {
  const path = fileURLToPath(
    new URL('../../../../../../packages/widget/src/types.ts', import.meta.url)
  )
  const src = readFileSync(path, 'utf8')
  const block = src.match(/WIDGET_LOCALES\s*=\s*\[([^\]]*)\]/)?.[1] ?? ''
  return [...block.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

describe('widget locale list', () => {
  it('covers exactly the app SUPPORTED_LOCALES (BCP-47 casing aside)', () => {
    const widget = readWidgetLocales()
    // Guard against the parse silently returning nothing.
    expect(widget.length).toBeGreaterThan(0)
    // The widget uses display casing (pt-BR, zh-CN); normalizeLocale lowercases
    // on the way in, so compare case-insensitively.
    expect(new Set(widget.map((l) => l.toLowerCase()))).toEqual(
      new Set(SUPPORTED_LOCALES.map((l) => l.toLowerCase()))
    )
  })
})
