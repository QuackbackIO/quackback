import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isDarkBackground } from '../colour-setters'
import { relativeLuminance } from '../expand'

const themeDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every theme module `entry` imports, directly or through another (type imports aside). */
function runtimeImports(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = readFileSync(resolve(themeDir, `${entry}.ts`), 'utf8')
  for (const match of source.matchAll(/^(?:import|export) (?!type\b)[^'"]*from '\.\/([\w-]+)'/gm)) {
    runtimeImports(match[1]!, seen)
  }
  return seen
}

describe('the theme every page generates', () => {
  // Route loaders generate the theme CSS, so these modules ship in the entry
  // chunk of every page. The Customise editor's code must stay out of them.
  it.each(['index', 'generator', 'fonts'])('%s loads none of the editor-only modules', (entry) => {
    const imports = runtimeImports(entry)
    for (const editorOnly of [
      'colour-setters',
      'readable-css',
      'css-parser',
      'brand-import',
      'font-names',
      'logo-ink',
    ]) {
      expect(imports.has(editorOnly), `${entry} reaches ${editorOnly}`).toBe(false)
    }
  })

  it('calls a page dark where the colour setters do', () => {
    for (const hex of [
      '#000000',
      '#0a0a0a',
      '#1f2937',
      '#6b7280',
      '#787878',
      '#808080',
      '#ffffff',
    ]) {
      expect(relativeLuminance(hex) < 0.2, hex).toBe(isDarkBackground(hex))
    }
  })
})
