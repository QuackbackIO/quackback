/**
 * The PDF and raster engine, loaded on first use. It is a WebAssembly build
 * of a C library; its own diagnostics would print parser complaints (which
 * can quote file bytes) straight to stderr, so they are dropped here before
 * the module initializes.
 */
import { loadDependency } from './result'

type Mupdf = typeof import('mupdf')

let loading: Promise<Mupdf> | null = null

export function loadMupdf(): Promise<Mupdf> {
  loading ??= loadDependency('mupdf', async () => {
    const g = globalThis as { $libmupdf_wasm_Module?: Record<string, unknown> }
    g.$libmupdf_wasm_Module = { ...g.$libmupdf_wasm_Module, print() {}, printErr() {} }
    return import('mupdf')
  }).catch((err) => {
    loading = null
    throw err
  })
  return loading
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
