/**
 * Where the font matcher reads its faces from. The server build copies each
 * face's Latin WOFF files into `brand-fonts/` beside the server output (see
 * build/brand-fonts.ts); the dev server and tests read them from the
 * @fontsource packages in node_modules. Either is found by walking up from
 * this module, so the output can be moved; BRAND_FONTS_DIR overrides both.
 * Files are local only: never fetched.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fontFileName, type Face } from './faces'

/** The folder the server build writes the files to, beside its output. */
export const BRAND_FONTS_DIR = 'brand-fonts'

export interface FontSource {
  /** The file for a face's weight. */
  file: (face: Pick<Face, 'pkg'>, weight: number) => string
  /** Where they were found, for logs. */
  root: string
}

/** The fonts beside a directory or above it: a build's `brand-fonts`, else node_modules/@fontsource. */
export function findFontSource(from: string): FontSource | null {
  const env = process.env.BRAND_FONTS_DIR
  if (env && existsSync(env)) return flat(env)
  for (let dir = from; ; dir = path.dirname(dir)) {
    const built = path.join(dir, BRAND_FONTS_DIR)
    if (existsSync(built)) return flat(built)
    const packages = path.join(dir, 'node_modules', '@fontsource')
    if (existsSync(path.join(packages, 'inter', 'files'))) {
      return {
        root: packages,
        file: (face, weight) => path.join(packages, face.pkg, 'files', fontFileName(face, weight)),
      }
    }
    if (path.dirname(dir) === dir) return null
  }
}

const flat = (root: string): FontSource => ({
  root,
  file: (face, weight) => path.join(root, fontFileName(face, weight)),
})

let source: FontSource | null | undefined

/** The fonts as this server finds them, once. */
export function fontSource(): FontSource | null {
  if (source === undefined) source = findFontSource(path.dirname(fileURLToPath(import.meta.url)))
  return source
}

/** A face's WOFF bytes, or null when the file is not there. */
export function readFontFile(face: Pick<Face, 'pkg'>, weight: number): Uint8Array | null {
  const found = fontSource()
  if (!found) return null
  try {
    return new Uint8Array(readFileSync(found.file(face, weight)))
  } catch {
    return null
  }
}
