/**
 * Build-time plugin: the chunk of each page the portal's root loads lazily,
 * for its server render to start.
 *
 * Home and the feed are each a dynamic `import()` from the portal's root, so
 * the browser learned of their chunks, and the dozens of chunks those import
 * in turn, only once the entry had loaded and run; on a slow phone the page
 * stayed unhydrated that much longer. This plugin records each page's chunk
 * from the client build and hands the URLs to the server build as the module
 * `virtual:quackback-lazy-graphs`. The server render of a page names its
 * chunk as a module script (feed-route.ts), one tag, so the browser walks the
 * page's import graph alongside the entry's. Listing the whole graph as
 * preload links instead cost 5 to 8 KB of every such page's HTML. The client
 * build gets an empty module.
 */
import path from 'path'
import type { Plugin } from 'vite'

export const LAZY_GRAPHS_ID = 'virtual:quackback-lazy-graphs'
const RESOLVED = `\0${LAZY_GRAPHS_ID}`

/** Each lazily loaded page's chunk, as a URL. */
export type LazyGraphs = Record<string, string>

interface BundleChunk {
  type: 'chunk'
  fileName: string
  facadeModuleId?: string | null
}

/** The pages' chunks, from a client bundle, by the page's module file. */
export function readLazyGraphs(
  bundle: Record<string, BundleChunk | { type: string }>,
  pages: Record<string, string>
): LazyGraphs {
  const graphs: LazyGraphs = {}
  for (const item of Object.values(bundle)) {
    if (item.type !== 'chunk') continue
    const chunk = item as BundleChunk
    const name = Object.keys(pages).find((page) => pages[page] === chunk.facadeModuleId)
    if (name) graphs[name] = chunk.fileName.startsWith('/') ? chunk.fileName : `/${chunk.fileName}`
  }
  return graphs
}

export function lazyGraphs(srcDir: string, pages: Record<string, string>): Plugin {
  const absolute = Object.fromEntries(
    Object.entries(pages).map(([name, file]) => [name, path.join(srcDir, file)])
  )
  let graphs: LazyGraphs = {}
  return {
    name: 'quackback:lazy-graphs',
    generateBundle(_, bundle) {
      if (this.environment?.name !== 'client') return
      graphs = readLazyGraphs(bundle as never, absolute)
    },
    resolveId(id) {
      return id === LAZY_GRAPHS_ID ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      // The browser needs none of it: only a server render starts the chunks.
      const shipped = this.environment?.name === 'client' ? {} : graphs
      return `export default ${JSON.stringify(shipped)}`
    },
  }
}
