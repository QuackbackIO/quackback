/**
 * The admin rail imports the settings nav sections to decide whether to offer
 * Settings. The module must stay plain data: an icon or a React component in its
 * import graph would ship the settings menu in every admin page's chunk.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(resolve(dir, file), 'utf8')

function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gms)].map(
    (match) => match[1]!
  )
}

describe('settings-nav-sections imports', () => {
  const source = read('settings-nav-sections.ts')
  const specifiers = importsOf(source)

  it('reads its imports', () => {
    expect(specifiers).toContain('./settings-pages')
  })

  it('imports no icon module and no React', () => {
    for (const specifier of specifiers) {
      expect(specifier).not.toMatch(/icons?/i)
      expect(specifier).not.toMatch(/^react($|\/)/)
      expect(specifier).not.toMatch(/\.tsx$/)
    }
  })

  it('imports only modules that are themselves free of icons and components', () => {
    for (const specifier of specifiers.filter((item) => item.startsWith('./'))) {
      expect(specifier).toBe('./settings-pages')
    }
    const pages = importsOf(read('settings-pages.ts'))
    for (const specifier of pages) {
      expect(specifier).not.toMatch(/icons?/i)
      expect(specifier).not.toMatch(/^react$/)
    }
  })

  it('is what the rail imports for the Settings entry', () => {
    const rail = importsOf(read('../admin-sidebar.tsx'))
    expect(rail).toContain('@/components/admin/settings/settings-nav-sections')
    expect(rail).not.toContain('@/components/admin/settings/settings-nav')
  })
})
