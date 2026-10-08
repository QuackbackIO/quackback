import { describe, expect, it } from 'vitest'

const modules = import.meta.glob('../*.json', { eager: true, import: 'default' })
const catalogs = Object.entries(modules).map(
  ([path, catalog]) =>
    [/([^/]+)\.json$/.exec(path)?.[1] ?? path, catalog as Record<string, string>] as const
)

// Customer-facing empty states stay calm: no exclamation marks, in any language.
const KEYS = ['portal.commentThread.empty', 'widget.commentList.empty']

describe('customer empty-state copy', () => {
  it.each(catalogs)('%s has no exclamation marks in the comment empty states', (_locale, catalog) => {
    for (const key of KEYS) {
      expect(catalog[key], key).toBeTruthy()
      expect(catalog[key], key).not.toMatch(/[!！¡]/)
    }
  })
})
