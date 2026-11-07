/**
 * Build-time plugin: where each bundled font's files ended up.
 *
 * A portal family loads with a dynamic `import()` of its CSS module (see
 * font-loader.ts), so the client build gives its stylesheet and font files
 * hashed names the server cannot know. This plugin records them from the
 * client build, by font id, and hands them to the server build as the module
 * `virtual:quackback-font-manifest`, so a portal page can link the
 * stylesheet and preload its Latin files during SSR. The client is built
 * before the server, as for the router's own manifest. In the dev server and
 * tests the manifest is empty and fonts load as the page runs.
 */
import { readFileSync } from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

export const FONT_MANIFEST_ID = 'virtual:quackback-font-manifest'
const RESOLVED = `\0${FONT_MANIFEST_ID}`

/** A family's stylesheet and its Latin woff2 files by weight, as URLs. */
export interface FontFiles {
  css: string
  latin: Record<string, string>
}
export type FontManifest = Record<string, FontFiles>

/** The font id each CSS module serves, from the loader's `case 'id': return import('...css')`. */
export function fontModules(loaderSource: string, srcDir: string): Map<string, string> {
  const modules = new Map<string, string>()
  const entry = /case '([a-z0-9-]+)':\s*return import\('@\/([^']+\.css)'\)/g
  for (const [, id, file] of loaderSource.matchAll(entry)) {
    modules.set(path.join(srcDir, file!), id!)
  }
  return modules
}

interface BundleChunk {
  type: 'chunk'
  facadeModuleId?: string | null
  viteMetadata?: { importedCss: Set<string> }
}
interface BundleAsset {
  type: 'asset'
  fileName: string
  source: string | Uint8Array
}

const LATIN = /url\(\s*["']?([^"')]*?-latin-(\d{3})-normal-[^"')]*?\.woff2)["']?\s*\)/g

/** The manifest from a client bundle: each font module's chunk, its stylesheet and that stylesheet's files. */
export function readFontManifest(
  bundle: Record<string, BundleChunk | BundleAsset | { type: string }>,
  modules: Map<string, string>
): FontManifest {
  const manifest: FontManifest = {}
  const url = (file: string) => (file.startsWith('/') ? file : `/${file}`)
  for (const item of Object.values(bundle)) {
    if (item.type !== 'chunk') continue
    const chunk = item as BundleChunk
    const id = chunk.facadeModuleId ? modules.get(chunk.facadeModuleId) : undefined
    if (!id) continue
    const cssFile = [...(chunk.viteMetadata?.importedCss ?? [])][0]
    const asset = cssFile ? (bundle[cssFile] as BundleAsset | undefined) : undefined
    if (!cssFile || asset?.type !== 'asset') continue
    const source =
      typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
    const latin: Record<string, string> = {}
    for (const [, file, weight] of source.matchAll(LATIN)) latin[weight!] ??= url(file!)
    manifest[id] = { css: url(cssFile), latin }
  }
  return manifest
}

export function fontManifest(srcDir: string): Plugin {
  let manifest: FontManifest = {}
  return {
    name: 'quackback:font-manifest',
    generateBundle(_, bundle) {
      if (this.environment?.name !== 'client') return
      const loader = readFileSync(path.join(srcDir, 'lib/shared/theme/font-loader.ts'), 'utf8')
      manifest = readFontManifest(bundle as never, fontModules(loader, srcDir))
    },
    resolveId(id) {
      return id === FONT_MANIFEST_ID ? RESOLVED : null
    },
    load(id) {
      return id === RESOLVED ? `export default ${JSON.stringify(manifest)}` : null
    },
  }
}
