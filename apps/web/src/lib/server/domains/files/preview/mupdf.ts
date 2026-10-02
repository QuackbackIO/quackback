/**
 * The PDF and raster engine, loaded on first use. It is a WebAssembly build
 * of a C library; its own diagnostics would print parser complaints (which
 * can quote file bytes) straight to stderr, so they are dropped here before
 * the module initializes.
 *
 * The module fetches `mupdf-wasm.wasm` from beside its own file. The server
 * build keeps the package whole in its traced `node_modules` for that reason
 * (`traceDeps` in vite.config.ts). When the file is missing the module's
 * loader aborts with a rejection nothing can catch, which would take the
 * process down, so the file is looked for before the module is imported.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadDependency, type DerivedObject } from './result'

type Mupdf = typeof import('mupdf')
type Page = InstanceType<Mupdf['Page']>

let loading: Promise<Mupdf> | null = null

function wasmPresent(): boolean {
  try {
    const entry = createRequire(import.meta.url).resolve('mupdf')
    return existsSync(join(dirname(entry), 'mupdf-wasm.wasm'))
  } catch {
    return false
  }
}

export function loadMupdf(): Promise<Mupdf> {
  loading ??= loadDependency('mupdf', async () => {
    if (!wasmPresent()) throw new Error('mupdf-wasm.wasm not found')
    const g = globalThis as { $libmupdf_wasm_Module?: Record<string, unknown> }
    g.$libmupdf_wasm_Module = { ...g.$libmupdf_wasm_Module, print() {}, printErr() {} }
    return import('mupdf')
  }).catch((err) => {
    loading = null
    throw err
  })
  return loading
}

/** Most pixels a render produces on either side, whatever a page or image claims. */
export const MAX_RENDER_SIDE = 2400

/**
 * `scale`, lowered as far as needed for a render of a `width` x `height` page
 * (in its own units) to stay within {@link MAX_RENDER_SIDE} on both sides.
 * Every render goes through this, so its size never rests on the caller's
 * arithmetic alone.
 */
export function cappedRenderScale(width: number, height: number, scale: number): number {
  return Math.min(scale, MAX_RENDER_SIDE / width, MAX_RENDER_SIDE / height)
}

/** Free a native object now rather than whenever the collector gets to it. */
export function destroy(...objects: Array<{ destroy(): void } | null | undefined>): void {
  for (const o of objects) {
    try {
      o?.destroy()
    } catch {
      // Already freed.
    }
  }
}

export interface ThumbnailOptions {
  /** Whether the pixmap keeps an alpha channel. Default: false. */
  alpha?: boolean
  /** Whether annotations and form widgets render into the pixmap. Default: false. */
  extras?: boolean
  /** Default: 'png'. */
  format?: 'png' | 'jpeg'
  /** JPEG quality, 0-100. Default: 80. */
  quality?: number
}

/**
 * Render a page to a pixmap at `scale`, encode it, and free the pixmap. A
 * PDF's first-page thumbnail and a raster image's both go through here.
 */
export function renderThumbnail(
  mupdf: Mupdf,
  page: Page,
  scale: number,
  options: ThumbnailOptions = {}
): DerivedObject {
  const { alpha = false, extras = false, format = 'png', quality = 80 } = options
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    alpha,
    extras
  )
  const bytes = format === 'jpeg' ? pixmap.asJPEG(quality).slice() : pixmap.asPNG().slice()
  destroy(pixmap)
  return {
    suffix: format === 'jpeg' ? 'thumb.jpg' : 'thumb.png',
    contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    bytes,
    field: 'thumbKey',
  }
}
