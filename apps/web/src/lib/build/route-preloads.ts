/**
 * Build-time plugin: a page's `modulepreload` links name its route chunks and
 * what those import directly, not everything they reach.
 *
 * Start 1.169 (start-plugin-core 1.171.51, TanStack/router#8695) builds each
 * route's preload list from the whole static import closure of its chunks. In
 * this app a route's chunks import their parent's (route-chunk-parents.ts), so
 * every page's list grew to the layout's entire eager graph: 1,548 preloads
 * across the manifest became 2,827, and the admin and portal layouts went from
 * 21 links to about 60. Every one is written into the document twice (a
 * `<link>` and the dehydrated manifest) and rendered by the head as a
 * component of its own, on every page. The browser loads exactly the same
 * code either way: the links only announce, a little earlier, chunks the
 * route's direct imports already announce one hop later.
 *
 * Start has no option for this, and its `transformAssets` hook can rewrite an
 * asset's URL but not drop one, so this plugin rebuilds the preload lists of
 * the generated start manifest the way Start 1.168 did. Stylesheets and
 * scripts are left exactly as Start built them. Rewriting the manifest itself,
 * rather than the HTML, keeps the document, the dehydrated copy the browser
 * hydrates from and any Early Hints in agreement.
 *
 * The rebuild, from Start 1.168's `buildRouteManifestRoutes` and
 * `dedupeNestedRouteManifestEntries`:
 *  - a route's list is each of its split chunks followed by that chunk's direct
 *    imports, in bundle order, without repeats;
 *  - the root route also lists the client entry and its direct imports;
 *  - walking down from the root, a route drops anything one of its ancestors
 *    already lists.
 *
 * The build fails if the manifest module or the route tree it needs is not
 * where Start 1.169 puts them, so a Start upgrade that moves them cannot
 * silently bring the long lists back.
 */
import { runInNewContext } from 'vm'
import type { Plugin } from 'vite'

/** Start's resolved id for its generated manifest module (`tanstack-start-manifest:v`). */
const MANIFEST_MODULE = '\0tanstack-start-manifest:v'
const MANIFEST_EXPORT = /^\s*export const tsrStartManifest = \(\) => \(([\s\S]*)\)\s*;?\s*$/
const ROOT_ROUTE_ID = '__root__'
const SPLIT_QUERY = 'tsr-split'

/** What the rebuild needs of one client chunk. */
export interface ClientChunk {
  fileName: string
  isEntry: boolean
  /** Static imports, direct only, as the bundle lists them. */
  imports: readonly string[]
  moduleIds: readonly string[]
}

/** A route as Start's route tree records it. */
export interface RouteTreeRoute {
  filePath?: string
  children?: string[]
  [key: string]: unknown
}

/** A route in the generated manifest. Only `preloads` is rebuilt. */
export interface ManifestRoute {
  filePath?: string
  children?: string[]
  preloads?: string[]
  css?: unknown[]
  scripts?: unknown[]
  [key: string]: unknown
}

export interface StartManifest {
  routes: Record<string, ManifestRoute>
  [key: string]: unknown
}

/** Route files a chunk holds split code of, as Start reads them (`?tsr-split=`). */
function routeFilesOf(chunk: ClientChunk): string[] {
  const files = new Set<string>()
  for (const id of chunk.moduleIds) {
    const query = id.indexOf('?')
    if (query < 0) continue
    if (!new URLSearchParams(id.slice(query + 1)).has(SPLIT_QUERY)) continue
    files.add(id.slice(0, query))
  }
  return [...files]
}

/** Append what `target` lacks of `items`, keeping order. */
function appendUnique(target: string[], items: readonly string[]): void {
  for (const item of items) if (!target.includes(item)) target.push(item)
}

/**
 * The manifest with every route's preloads rebuilt from direct imports.
 * `assetPath` maps a chunk's file name to the URL the manifest uses for it.
 */
export function withDirectImportPreloads({
  manifest,
  routeTree,
  chunks,
  assetPath,
}: {
  manifest: StartManifest
  routeTree: Record<string, RouteTreeRoute>
  chunks: readonly ClientChunk[]
  assetPath: (fileName: string) => string
}): StartManifest {
  const chunksByRouteFile = new Map<string, ClientChunk[]>()
  for (const chunk of chunks) {
    for (const file of routeFilesOf(chunk)) {
      const list = chunksByRouteFile.get(file) ?? []
      list.push(chunk)
      chunksByRouteFile.set(file, list)
    }
  }
  const entries = chunks.filter((chunk) => chunk.isEntry)
  if (entries.length !== 1) throw new Error(`expected one client entry, found ${entries.length}`)
  const directPreloads = (chunk: ClientChunk) => [chunk.fileName, ...chunk.imports].map(assetPath)

  const preloads = new Map<string, string[]>()
  for (const [routeId, route] of Object.entries(routeTree)) {
    const list: string[] = []
    if (route.filePath) {
      for (const chunk of chunksByRouteFile.get(route.filePath) ?? []) {
        appendUnique(list, directPreloads(chunk))
      }
    }
    preloads.set(routeId, list)
  }
  const rootList = preloads.get(ROOT_ROUTE_ID) ?? []
  appendUnique(rootList, directPreloads(entries[0]!))
  preloads.set(ROOT_ROUTE_ID, rootList)

  // Down the tree from the root: drop what an ancestor already lists.
  const seen = new Set<string>()
  const dedupe = (routeId: string) => {
    const kept = (preloads.get(routeId) ?? []).filter((href) => !seen.has(href))
    preloads.set(routeId, kept)
    for (const href of kept) seen.add(href)
    for (const child of routeTree[routeId]?.children ?? []) {
      if (!routeTree[child]) throw new Error(`route tree lists missing child ${child}`)
      dedupe(child)
    }
    for (const href of kept) seen.delete(href)
  }
  dedupe(ROOT_ROUTE_ID)

  const routes: Record<string, ManifestRoute> = {}
  for (const routeId of Object.keys(routeTree)) {
    const route: ManifestRoute = manifest.routes[routeId]
      ? { ...manifest.routes[routeId] }
      : { ...routeTree[routeId] }
    const list = preloads.get(routeId) ?? []
    if (list.length > 0) route.preloads = list
    else delete route.preloads
    if (route.preloads?.length || route.css?.length || route.scripts?.length) routes[routeId] = route
  }
  for (const routeId of Object.keys(manifest.routes)) {
    if (!(routeId in routeTree)) throw new Error(`manifest route ${routeId} is not in the route tree`)
  }
  return { ...manifest, routes }
}

/**
 * How the manifest writes a chunk's URL, read off the client entry's script
 * tag, which Start writes as its public base path followed by the file name.
 */
export function assetPathFrom(
  manifest: StartManifest,
  chunks: readonly ClientChunk[]
): (fileName: string) => string {
  const entry = chunks.find((chunk) => chunk.isEntry)
  const scripts = (manifest.routes[ROOT_ROUTE_ID]?.scripts ?? []) as { attrs?: { src?: unknown } }[]
  const src = scripts.map((script) => script.attrs?.src).find((s) => typeof s === 'string')
  if (!entry || typeof src !== 'string' || !src.endsWith(entry.fileName)) {
    throw new Error('the start manifest does not load the client entry from the root route')
  }
  const base = src.slice(0, src.length - entry.fileName.length)
  return (fileName) => base + fileName
}

/** The manifest the generated module's code returns. */
export function readManifestModule(code: string): StartManifest {
  const match = MANIFEST_EXPORT.exec(code)
  if (!match) throw new Error('the start manifest module is not in the expected shape')
  return runInNewContext(`(${match[1]})`) as StartManifest
}

/**
 * The plugin. The client build's chunks are captured as it is written, then
 * the server build's manifest module is rewritten when it is loaded.
 */
export function routePreloadsFromDirectImports(): Plugin {
  let chunks: ClientChunk[] | undefined
  let rewritten = false
  return {
    name: 'quackback:route-preloads-from-direct-imports',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      if (this.environment?.name !== 'client') return
      chunks = []
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        chunks.push({
          fileName: output.fileName,
          isEntry: output.isEntry,
          imports: output.imports,
          moduleIds: output.moduleIds,
        })
      }
    },
    transform: {
      filter: { id: /tanstack-start-manifest:v/ },
      handler(code, id) {
        if (id !== MANIFEST_MODULE || this.environment?.name === 'client') return null
        if (!chunks) throw new Error('the client build ran after the start manifest was built')
        const routeTree = (globalThis as { TSS_ROUTES_MANIFEST?: Record<string, RouteTreeRoute> })
          .TSS_ROUTES_MANIFEST
        if (!routeTree) throw new Error("Start's route tree (TSS_ROUTES_MANIFEST) is not set")
        const manifest = readManifestModule(code)
        const next = withDirectImportPreloads({
          manifest,
          routeTree,
          chunks,
          assetPath: assetPathFrom(manifest, chunks),
        })
        rewritten = true
        return {
          code: `export const tsrStartManifest = () => (${JSON.stringify(next)})`,
          map: null,
        }
      },
    },
    buildEnd() {
      if (this.environment?.name === 'ssr' && chunks && !rewritten) {
        throw new Error('the start manifest module was never rewritten')
      }
    },
  }
}
