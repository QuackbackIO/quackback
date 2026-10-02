/**
 * The production build's half of `?server-worker` imports, checked against a
 * stand-in plugin context: the SSR build leaves the import for the nitro
 * build, which emits the worker as a chunk and points at it relative to the
 * importing chunk. (Tests run the dev half for real: the preview worker
 * tests start the script it bundles.)
 */
import { describe, expect, it, vi } from 'vitest'
import path from 'path'
import { serverWorkers } from '../server-workers'

const WORKER = path.resolve(__dirname, '../../server/domains/files/preview/preview-worker.ts')
const IMPORTER = path.resolve(__dirname, '../../server/domains/files/preview/sandbox.ts')

type Hook = (this: unknown, ...args: unknown[]) => unknown

function buildPlugin() {
  const plugin = serverWorkers()
  const configResolved = plugin.configResolved as Hook
  configResolved.call(undefined, {
    command: 'build',
    environments: { client: {}, ssr: {}, nitro: {} },
  })
  return plugin
}

function context(environment: string) {
  return {
    environment: { name: environment },
    resolve: vi.fn(async () => ({ id: WORKER })),
    emitFile: vi.fn(() => 'ref123'),
  }
}

describe('serverWorkers in a production build', () => {
  it('leaves the import to the nitro build when building the SSR environment', async () => {
    const plugin = buildPlugin()
    const ctx = context('ssr')
    const resolved = await (plugin.resolveId as Hook).call(ctx, './preview-worker?server-worker', IMPORTER)
    expect(resolved).toEqual({ id: `server-worker:${WORKER}`, external: true })
    expect(ctx.resolve).toHaveBeenCalledWith('./preview-worker', IMPORTER, { skipSelf: true })
  })

  it('emits the worker as a chunk in the nitro build and points at it beside the importer', async () => {
    const plugin = buildPlugin()
    const ctx = context('nitro')
    const id = await (plugin.resolveId as Hook).call(ctx, `server-worker:${WORKER}`, IMPORTER)
    expect(id).toBe(`\0server-worker:${WORKER}`)

    const code = await (plugin.load as Hook).call(ctx, id)
    expect(ctx.emitFile).toHaveBeenCalledWith({ type: 'chunk', id: WORKER, name: 'preview-worker' })
    expect(code).toBe('export default new URL(import.meta.ROLLUP_FILE_URL_ref123)')

    const resolveFileUrl = plugin.resolveFileUrl as Hook
    expect(
      resolveFileUrl.call(ctx, { referenceId: 'ref123', relativePath: '../_chunks/preview-worker.mjs' })
    ).toBe('new URL("../_chunks/preview-worker.mjs", import.meta.url).href')
    expect(
      resolveFileUrl.call(ctx, { referenceId: 'ref123', relativePath: 'preview-worker.mjs' })
    ).toBe('new URL("./preview-worker.mjs", import.meta.url).href')
    // Files other plugins emitted keep their own rendering.
    expect(
      resolveFileUrl.call(ctx, { referenceId: 'other', relativePath: 'a.png' })
    ).toBeNull()
  })

  it('ignores every other import', async () => {
    const plugin = buildPlugin()
    const ctx = context('nitro')
    expect(await (plugin.resolveId as Hook).call(ctx, './preview-worker', IMPORTER)).toBeNull()
    expect(await (plugin.load as Hook).call(ctx, WORKER)).toBeNull()
  })
})
