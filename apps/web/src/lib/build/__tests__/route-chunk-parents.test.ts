/**
 * The build links each route's split components to the component of the
 * route it renders under, read from the generated route tree. If the tree's
 * shape stops parsing, the links (and the chunks they merge) disappear
 * silently, so the parse is checked against the real tree.
 */
import { describe, expect, it, vi } from 'vitest'
import path from 'path'
import { readRouteParents, routeChunksImportTheirParent } from '../route-chunk-parents'

const SRC = path.resolve(__dirname, '../../..')
const TREE = path.join(SRC, 'routeTree.gen.ts')
const route = (file: string) => path.join(SRC, 'routes', file)

describe('readRouteParents', () => {
  const parents = readRouteParents(TREE)

  it('maps a nested route to the route it renders under', () => {
    expect(parents.get(route('admin/feedback.index.tsx'))).toBe(route('admin/feedback.tsx'))
    expect(parents.get(route('admin/feedback.tsx'))).toBe(route('admin.tsx'))
    expect(parents.get(route('_portal/index.tsx'))).toBe(route('_portal.tsx'))
    expect(parents.get(route('_portal.b.$slug.posts.$postId.tsx'))).toBe(route('_portal.tsx'))
  })

  it('maps a route directly under the root to null', () => {
    expect(parents.get(route('admin.tsx'))).toBeNull()
    expect(parents.get(route('_portal.tsx'))).toBeNull()
    expect(parents.get(route('widget.tsx'))).toBeNull()
  })
})

type Handler = (this: unknown, code: string, id: string) => Promise<{ code: string } | null>

function transform(withComponent: string[], environment = 'client') {
  const plugin = routeChunksImportTheirParent(TREE)
  const handler = (plugin.transform as { handler: Handler }).handler
  const load = vi.fn(async ({ id }: { id: string }) => ({
    exports: withComponent.some((file) => id === `${file}?tsr-split=component`) ? ['component'] : [],
  }))
  const context = { environment: { name: environment }, load }
  return (id: string) => handler.call(context, 'export { X as component }', id)
}

describe('routeChunksImportTheirParent', () => {
  const page = `${route('admin/feedback.index.tsx')}?tsr-split=component`

  it("re-exports the parent's component from a route's split", async () => {
    const result = await transform([route('admin/feedback.tsx'), route('admin.tsx')])(page)
    expect(result?.code).toContain(
      `export { component as __parentRouteComponent } from ${JSON.stringify(
        `${route('admin/feedback.tsx')}?tsr-split=component`
      )}`
    )
  })

  it('links an error component split the same way', async () => {
    const result = await transform([route('admin/feedback.tsx')])(
      `${route('admin/feedback.index.tsx')}?tsr-split=errorComponent`
    )
    expect(result?.code).toContain(`${route('admin/feedback.tsx')}?tsr-split=component`)
  })

  it('skips a parent without a component for the nearest ancestor with one', async () => {
    const result = await transform([route('admin.tsx')])(page)
    expect(result?.code).toContain(`${JSON.stringify(`${route('admin.tsx')}?tsr-split=component`)}`)
    expect(result?.code).not.toContain('admin/feedback.tsx?')
    // No ancestor with a component: nothing to link to.
    expect(await transform([])(page)).toBeNull()
  })

  it('leaves a route under the root, a split loader and the server build alone', async () => {
    expect(await transform([])(`${route('admin.tsx')}?tsr-split=component`)).toBeNull()
    expect(
      await transform([route('admin/feedback.tsx')])(
        `${route('admin/feedback.index.tsx')}?tsr-split=loader`
      )
    ).toBeNull()
    expect(await transform([route('admin/feedback.tsx')], 'ssr')(page)).toBeNull()
  })
})
