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
const LOADER = /[?&]tsr-split=[^&]*loader/

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

/**
 * The plugin. `routeTreeFile` is read on the first split it sees, after the
 * router plugin has generated it. A parent without a component of its own is
 * skipped for the nearest ancestor that has one.
 */
export function routeChunksImportTheirParent(routeTreeFile: string): Plugin {
  let parents: Map<string, string | null> | undefined
  const exportsComponent = new Map<string, Promise<boolean>>()
  return {
    name: 'quackback:route-chunks-import-their-parent',
    apply: 'build',
    enforce: 'post',
    transform: {
      filter: { id: SPLIT },
      async handler(code, id) {
        // A loader waits on nothing but its own code.
        if (this.environment?.name !== 'client' || !SPLIT.test(id) || LOADER.test(id)) return null
        parents ??= readRouteParents(routeTreeFile)
        const hasComponent = (file: string) => {
          let known = exportsComponent.get(file)
          if (!known) {
            known = this.load({ id: `${file}?tsr-split=component` }).then(
              (info) => info.exports?.includes('component') ?? false,
              () => false
            )
            exportsComponent.set(file, known)
          }
          return known
        }
        let parent = parents.get(id.split('?')[0]!) ?? null
        while (parent && !(await hasComponent(parent))) parent = parents.get(parent) ?? null
        if (!parent) return null
        const specifier = JSON.stringify(`${parent}?tsr-split=component`)
        return {
          code: `${code}\nexport { component as __parentRouteComponent } from ${specifier}\n`,
          map: null,
        }
      },
    },
  }
}
