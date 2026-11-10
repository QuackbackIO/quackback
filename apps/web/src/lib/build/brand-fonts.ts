/**
 * Build-time plugin: the font matcher's faces in the server output.
 *
 * Brand matching draws a screenshot's words in each bundled face to find the
 * closest (lib/server/domains/design/extract/fonts), reading each face's Latin
 * WOFF files on the server. Nothing imports those files, so no bundler keeps
 * them: this plugin writes them into `brand-fonts/` of the server build (the
 * nitro environment, which writes `.output/server`), where the matcher finds
 * them by walking up from its own module. The dev server and tests read the
 * same files from node_modules/@fontsource.
 */
import { readFileSync } from 'fs'
import path from 'path'
import type { Plugin } from 'vite'
import { allFontFiles } from '../server/domains/design/extract/fonts/faces'

/** The folder beside the server output; files.ts reads the same name. */
const DIR = 'brand-fonts'

export interface FontAsset {
  fileName: string
  source: Uint8Array
}

/** Each face's files as the server build emits them. */
export function brandFontAssets(fontsource: string): FontAsset[] {
  return allFontFiles().map(({ pkg, file }) => ({
    fileName: `${DIR}/${file}`,
    source: new Uint8Array(readFileSync(path.join(fontsource, pkg, 'files', file))),
  }))
}

export function brandFonts(fontsource: string): Plugin {
  return {
    name: 'quackback:brand-fonts',
    apply: 'build',
    generateBundle() {
      // Once, into the build that writes the server: not the client, not the SSR pass nitro rebundles.
      if (this.environment?.name !== 'nitro') return
      for (const asset of brandFontAssets(fontsource)) {
        this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source })
      }
    },
  }
}
