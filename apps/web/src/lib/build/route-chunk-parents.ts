/**
 * Build-time plugin: each route's split components import the component of
 * the route they render under.
 *
 * The router imports every route's component chunk from the route tree in the
 * entry, so the bundler cannot tell that a page under /admin always has the
 * admin layout's chunk loaded as well. Usage-based splitting then gives a
 * module the layout shares with one admin page a chunk of its own, although
 * every admin page loads it, and does the same for every other combination of
 * a layout and its pages: dozens of sub-kilobyte chunks per page. Re-exporting
 * the parent's component from each split states that dependency in the module
 * graph. Everything the parent reaches is then reached by all of its
 * descendants, so it stays in one chunk with the parent's own modules, while
 * code only some pages use keeps chunks of its own. A page loads the same code
 * as before, in fewer files, and a lazy component's code stays behind its
 * lazy boundary.
 */
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type { Plugin } from 'vite'

const SPLIT = /[?&]tsr-split=/

/** A pattern matching exactly one module id. */
const exactly = (file: string) => new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
const LOADER = /[?&]tsr-split=[^&]*loader/
const COMPONENT = /[?&]tsr-split=component(&|$)/

/** The specifier of a route file's component split. */
const componentOf = (routeFile: string) => JSON.stringify(`${routeFile}?tsr-split=component`)

/**
 * Route files and the route file each renders under, read from the generated
 * route tree (`getParentRoute`). A route directly under the root maps to
 * null: the root route is not split, it is part of the entry.
 */
export function readRouteParents(routeTreeFile: string): Map<string, string | null> {
  const source = readFileSync(routeTreeFile, 'utf8')
  const dir = path.dirname(routeTreeFile)
  const fileOf = new Map<string, string>()
  for (const [, ident, specifier] of source.matchAll(
    /import \{ Route as (\w+) \} from '(\.\/routes\/[^']+)'/g
  )) {
    const base = path.resolve(dir, specifier!)
    const file = ['.tsx', '.ts', '.jsx', '.js'].map((ext) => base + ext).find((f) => existsSync(f))
    if (file) fileOf.set(ident!, file)
  }
  const updates = [
    ...source.matchAll(/const (\w+) = (\w+)\.update\(\{[^}]*?getParentRoute: \(\) => (\w+),/g),
  ]
  const importOf = new Map(updates.map(([, route, ident]) => [route!, ident!]))
  const parents = new Map<string, string | null>()
  for (const [, , ident, parentRoute] of updates) {
    const file = fileOf.get(ident!)
    if (file) parents.set(file, fileOf.get(importOf.get(parentRoute!) ?? '') ?? null)
  }
  return parents
}

/** Modules and route components the route tree alone does not place. */
export interface RouteChunkLinks {
  /**
   * Modules a route loads lazily itself, by file, with that route's file.
   * Each is linked as that route's own split would be: to its parent's
   * component.
   */
  lazyChildren?: Record<string, string>
  /**
   * Route files whose component another route also renders, with that
   * route's file. The component's split re-exports the other route's
   * component split too. The server preloads a route's chunks, the chunks
   * holding any split of its file, so this one is preloaded for both.
   */
  sharedComponents?: Record<string, string>
}

/**
 * The plugin. `routeTreeFile` is read on the first split it sees, after the
 * router plugin has generated it. A parent without a component of its own is
 * skipped for the nearest ancestor that has one.
 */
export function routeChunksImportTheirParent(
  routeTreeFile: string,
  { lazyChildren = {}, sharedComponents = {} }: RouteChunkLinks = {}
): Plugin {
  let parents: Map<string, string | null> | undefined
  const exportsComponent = new Map<string, Promise<boolean>>()
  return {
    name: 'quackback:route-chunks-import-their-parent',
    apply: 'build',
    enforce: 'post',
    transform: {
      filter: { id: [SPLIT, ...Object.keys(lazyChildren).map(exactly)] },
      async handler(code, id) {
        const file = id.split('?')[0]!
        const lazyRoute = SPLIT.test(id) ? undefined : lazyChildren[id]
        // A loader waits on nothing but its own code.
        if (this.environment?.name !== 'client' || (!SPLIT.test(id) && !lazyRoute) || LOADER.test(id))
          return null
        parents ??= readRouteParents(routeTreeFile)
        const hasComponent = (routeFile: string) => {
          let known = exportsComponent.get(routeFile)
          if (!known) {
            known = this.load({ id: `${routeFile}?tsr-split=component` }).then(
              (info) => info.exports?.includes('component') ?? false,
              () => false
            )
            exportsComponent.set(routeFile, known)
          }
          return known
        }
        const links: string[] = []
        let parent = parents.get(lazyRoute ?? file) ?? null
        while (parent && !(await hasComponent(parent))) parent = parents.get(parent) ?? null
        if (parent) links.push(`export { component as __parentRouteComponent } from ${componentOf(parent)}`)
        const sharedWith = COMPONENT.test(id) ? sharedComponents[file] : undefined
        if (sharedWith && (await hasComponent(sharedWith)))
          links.push(`export { component as __sharedRouteComponent } from ${componentOf(sharedWith)}`)
        if (links.length === 0) return null
        return { code: `${code}\n${links.join('\n')}\n`, map: null }
      },
    },
  }
}
