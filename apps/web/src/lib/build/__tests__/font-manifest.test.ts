/**
 * The font manifest: which CSS module serves each font id, read from the
 * loader itself, and each module's stylesheet and Latin files from the client
 * bundle, so the portal's head can link them.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_FONT_IDS } from '@/lib/shared/design/options'
import { fontModules, readFontManifest } from '../font-manifest'

const SRC = path.resolve(import.meta.dirname, '../../..')
const loader = readFileSync(path.join(SRC, 'lib/shared/theme/font-loader.ts'), 'utf8')

describe('fontModules', () => {
  it('reads every bundled family with files from the loader', () => {
    const modules = fontModules(loader, SRC)
    // Inter ships with the app's own stylesheet; the system stacks have no files.
    const withoutFiles = ['inter', 'system', 'system-mono']
    expect([...modules.values()].sort()).toEqual(
      BUNDLED_FONT_IDS.filter((id) => !withoutFiles.includes(id)).sort()
    )
    expect(modules.get(path.join(SRC, 'styles/fonts/plus-jakarta-sans.css'))).toBe('jakarta')
  })
})

describe('readFontManifest', () => {
  const modules = new Map([[path.join(SRC, 'styles/fonts/fraunces.css'), 'fraunces']])
  const css = [
    '@font-face{font-family:Fraunces;src:url(/assets/fraunces-latin-ext-400-normal-a1.woff2) format("woff2")}',
    '@font-face{font-family:Fraunces;src:url(/assets/fraunces-latin-400-normal-b2.woff2) format("woff2"),url(/assets/fraunces-latin-400-normal-c3.woff) format("woff")}',
    '@font-face{font-family:Fraunces;src:url("/assets/fraunces-latin-700-normal-d4.woff2") format("woff2")}',
    '@font-face{font-family:Fraunces;src:url(/assets/fraunces-latin-700-italic-e5.woff2) format("woff2")}',
  ].join('\n')

  it('records each font module’s stylesheet and its Latin woff2 files by weight', () => {
    const manifest = readFontManifest(
      {
        'assets/fraunces-x.js': {
          type: 'chunk',
          facadeModuleId: path.join(SRC, 'styles/fonts/fraunces.css'),
          viteMetadata: { importedCss: new Set(['assets/fraunces-DbX7.css']) },
        },
        'assets/fraunces-DbX7.css': { type: 'asset', fileName: 'assets/fraunces-DbX7.css', source: css },
        'assets/index-1.js': {
          type: 'chunk',
          facadeModuleId: path.join(SRC, 'main.tsx'),
          viteMetadata: { importedCss: new Set(['assets/index-1.css']) },
        },
        'assets/index-1.css': { type: 'asset', fileName: 'assets/index-1.css', source: css },
      },
      modules
    )
    expect(manifest).toEqual({
      fraunces: {
        css: '/assets/fraunces-DbX7.css',
        latin: {
          '400': '/assets/fraunces-latin-400-normal-b2.woff2',
          '700': '/assets/fraunces-latin-700-normal-d4.woff2',
        },
      },
    })
  })
})
