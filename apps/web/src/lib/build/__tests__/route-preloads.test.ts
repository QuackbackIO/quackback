/**
 * The start manifest's preload lists are rebuilt from direct imports, the way
 * Start 1.168 built them, and nothing else in the manifest changes.
 *
 * The fixture is the shape that made the lists long: a page's chunk imports
 * its layout's chunk (route-chunk-parents.ts), which imports a component
 * chunk, which imports a library chunk.
 */
import { describe, expect, it } from 'vitest'
import {
  assetPathFrom,
  readManifestModule,
  withDirectImportPreloads,
  type ClientChunk,
  type StartManifest,
} from '../route-preloads'

const split = (file: string) => `/src/routes/${file}?tsr-split=component`

const chunks: ClientChunk[] = [
  { fileName: 'assets/main.js', isEntry: true, imports: ['assets/runtime.js'], moduleIds: [] },
  { fileName: 'assets/runtime.js', isEntry: false, imports: [], moduleIds: [] },
  {
    fileName: 'assets/admin.js',
    isEntry: false,
    imports: ['assets/main.js', 'assets/dialog.js'],
    moduleIds: [split('admin.tsx')],
  },
  { fileName: 'assets/dialog.js', isEntry: false, imports: ['assets/floating.js'], moduleIds: [] },
  { fileName: 'assets/floating.js', isEntry: false, imports: [], moduleIds: [] },
  {
    fileName: 'assets/users.js',
    isEntry: false,
    imports: ['assets/main.js', 'assets/admin.js', 'assets/table.js', 'assets/dialog.js'],
    moduleIds: [split('admin/users.tsx')],
  },
  { fileName: 'assets/table.js', isEntry: false, imports: ['assets/floating.js'], moduleIds: [] },
  {
    fileName: 'assets/plain.js',
    isEntry: false,
    imports: ['assets/main.js', 'assets/dialog.js'],
    moduleIds: [split('plain.tsx')],
  },
]

const routeTree = {
  __root__: { filePath: '/src/routes/__root.tsx', children: ['/admin', '/plain'] },
  '/admin': { filePath: '/src/routes/admin.tsx', children: ['/admin/users'] },
  '/admin/users': { filePath: '/src/routes/admin/users.tsx' },
  '/plain': { filePath: '/src/routes/plain.tsx' },
}

const entryScript = { attrs: { type: 'module', async: true, src: '/assets/main.js' } }

/** What Start 1.169 generates: every chunk the route's chunks reach, transitively. */
const startManifest: StartManifest = {
  routes: {
    __root__: {
      ...routeTree.__root__,
      preloads: ['/assets/main.js', '/assets/runtime.js'],
      scripts: [entryScript],
      css: ['/assets/main.css'],
    },
    '/admin': {
      ...routeTree['/admin'],
      preloads: ['/assets/admin.js', '/assets/dialog.js', '/assets/floating.js'],
      css: ['/assets/admin.css'],
    },
    '/admin/users': {
      ...routeTree['/admin/users'],
      preloads: ['/assets/users.js', '/assets/table.js'],
    },
    '/plain': {
      ...routeTree['/plain'],
      preloads: ['/assets/plain.js', '/assets/dialog.js', '/assets/floating.js'],
    },
  },
}

const rebuild = (manifest = startManifest) =>
  withDirectImportPreloads({
    manifest,
    routeTree,
    chunks,
    assetPath: assetPathFrom(manifest, chunks),
  }).routes

describe('withDirectImportPreloads', () => {
  it('lists a route chunk and its direct imports, not what those import', () => {
    expect(rebuild()['/admin']?.preloads).toEqual(['/assets/admin.js', '/assets/dialog.js'])
  })

  it('drops what an ancestor already lists, but keeps what only a sibling lists', () => {
    expect(rebuild()['/admin/users']?.preloads).toEqual(['/assets/users.js', '/assets/table.js'])
    expect(rebuild().__root__?.preloads).toEqual(['/assets/main.js', '/assets/runtime.js'])
    expect(rebuild()['/plain']?.preloads).toEqual(['/assets/plain.js', '/assets/dialog.js'])
  })

  it('keeps every stylesheet and script as Start built them', () => {
    const routes = rebuild()
    expect(routes.__root__?.scripts).toEqual([entryScript])
    expect(routes.__root__?.css).toEqual(['/assets/main.css'])
    expect(routes['/admin']?.css).toEqual(['/assets/admin.css'])
  })

  it('restores a route whose transitive list an ancestor had swallowed whole', () => {
    // Under the transitive lists the layout reaches users.js itself, so the
    // page had nothing left and Start dropped its entry.
    const swallowed: StartManifest = {
      routes: {
        ...startManifest.routes,
        '/admin': {
          ...startManifest.routes['/admin'],
          preloads: [...startManifest.routes['/admin']!.preloads!, '/assets/users.js'],
        },
      },
    }
    delete swallowed.routes['/admin/users']
    expect(rebuild(swallowed)['/admin/users']).toEqual({
      ...routeTree['/admin/users'],
      preloads: ['/assets/users.js', '/assets/table.js'],
    })
  })

  it('drops a route left with nothing to load', () => {
    const tree = { ...routeTree, '/admin': { ...routeTree['/admin'], children: [] } }
    const routes = withDirectImportPreloads({
      manifest: startManifest,
      routeTree: {
        ...tree,
        '/admin/users': { filePath: '/src/routes/nowhere.tsx' },
      },
      chunks,
      assetPath: (file) => `/${file}`,
    }).routes
    expect(routes['/admin/users']).toBeUndefined()
  })

  it('fails when the manifest names a route the tree does not have', () => {
    const manifest = { routes: { ...startManifest.routes, '/gone': { preloads: ['/x.js'] } } }
    expect(() => rebuild(manifest)).toThrow('/gone')
  })
})

describe('assetPathFrom', () => {
  it("reads Start's public base off the entry script", () => {
    const manifest: StartManifest = {
      routes: { __root__: { scripts: [{ attrs: { src: 'https://cdn.example.com/app/assets/main.js' } }] } },
    }
    expect(assetPathFrom(manifest, chunks)('assets/x.js')).toBe(
      'https://cdn.example.com/app/assets/x.js'
    )
  })

  it('fails when the root route does not load the entry', () => {
    expect(() => assetPathFrom({ routes: { __root__: {} } }, chunks)).toThrow('client entry')
  })
})

describe('readManifestModule', () => {
  it('reads the manifest Start writes into its module', () => {
    const code = `export const tsrStartManifest = () => ({ routes: { __root__: { children: void 0, preloads: ["/a.js"] } } })`
    expect(readManifestModule(code)).toEqual({
      routes: { __root__: { children: undefined, preloads: ['/a.js'] } },
    })
  })

  it('fails on any other shape', () => {
    expect(() => readManifestModule('export default {}')).toThrow('expected shape')
  })
})
