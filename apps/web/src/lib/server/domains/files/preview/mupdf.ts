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
import { loadDependency } from './result'

type Mupdf = typeof import('mupdf')

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
