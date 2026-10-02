/**
 * Build-time plugin: worker threads for server code.
 *
 * `import url from './x?server-worker'` gives a server module the file URL of
 * a script that runs `./x.ts`, and everything it imports, when handed to
 * `new Worker(url)` from `node:worker_threads`. Bundlers leave such a script
 * out on their own: nothing imports it, a worker only names it.
 *
 *  - Production build. The SSR environment's output is bundled again by the
 *    nitro environment, which writes the server, so the SSR build keeps the
 *    import as an external reference (`server-worker:<file>`) and the nitro
 *    build emits the module as a chunk of its own beside the rest of the
 *    server, sharing chunks and packages with it. The URL is relative to the
 *    importing chunk, so the output can move.
 *  - Dev server and tests. The module is bundled on first use into
 *    `node_modules/.cache/server-workers` of the package it belongs to, with
 *    packages left as imports so they resolve from that package's own
 *    `node_modules`, and is bundled again when a file behind it changes.
 */
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { Plugin } from 'vite'

const QUERY = '?server-worker'
/** The importing module's view of the worker: a module whose default export is its URL. */
const VIRTUAL = '\0server-worker:'
/** How the SSR build leaves the import for the nitro build: kept verbatim, resolved there. */
const DEFERRED = 'server-worker:'

/** The nearest directory above `file` with a package.json. */
function packageRoot(file: string): string {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
  }
  return path.dirname(file)
}

/** Bundle the worker module for a process that runs sources (dev, tests); returns the script. */
async function bundleForDev(file: string): Promise<{ script: string; modules: string[] }> {
  const root = packageRoot(file)
  const { build } = await import('vite')
  const output = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    resolve: { tsconfigPaths: true },
    build: {
      ssr: file,
      write: false,
      minify: false,
      copyPublicDir: false,
      rolldownOptions: { output: { format: 'esm', codeSplitting: false } },
    },
  })
  const outputs = Array.isArray(output) ? output : [output]
  const chunk = outputs
    .flatMap((o) => ('output' in o ? o.output : []))
    .find((o) => o.type === 'chunk' && o.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error(`server worker ${file} did not bundle`)

  const name = path.basename(file).replace(/\.[^.]+$/, '')
  const hash = createHash('sha256').update(chunk.code).digest('hex').slice(0, 16)
  const dir = path.join(root, 'node_modules', '.cache', 'server-workers')
  const script = path.join(dir, `${name}-${hash}.mjs`)
  if (!existsSync(script)) {
    mkdirSync(dir, { recursive: true })
    // Written whole, then renamed: a concurrent reader never sees half a file.
    const partial = `${script}.${process.pid}.tmp`
    writeFileSync(partial, chunk.code)
    renameSync(partial, script)
  }
  return { script, modules: Object.keys(chunk.modules) }
}

export function serverWorkers(): Plugin {
  let building = false
  let nitroRebundles = false
  /** Reference ids of the worker chunks this plugin emitted. */
  const emitted = new Set<string>()
  return {
    name: 'quackback:server-workers',
    enforce: 'pre',
    configResolved(config) {
      building = config.command === 'build'
      nitroRebundles = 'nitro' in config.environments
    },
    async resolveId(source, importer) {
      let file: string | undefined
      if (source.startsWith(DEFERRED)) {
        file = source.slice(DEFERRED.length)
      } else if (source.endsWith(QUERY)) {
        const resolved = await this.resolve(source.slice(0, -QUERY.length), importer, {
          skipSelf: true,
        })
        file = resolved?.id
      }
      if (!file) return null
      if (building && nitroRebundles && this.environment.name === 'ssr') {
        return { id: DEFERRED + file, external: true }
      }
      return VIRTUAL + file
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL)) return null
      const file = id.slice(VIRTUAL.length)
      if (building) {
        const ref = this.emitFile({
          type: 'chunk',
          id: file,
          name: path.basename(file).replace(/\.[^.]+$/, ''),
        })
        emitted.add(ref)
        return `export default new URL(import.meta.ROLLUP_FILE_URL_${ref})`
      }
      const { script, modules } = await bundleForDev(file)
      for (const module of modules) if (path.isAbsolute(module)) this.addWatchFile(module)
      return `export default new URL(${JSON.stringify(pathToFileURL(script).href)})`
    },
    // A server chunk finds the worker beside itself on disk, wherever the
    // output is deployed; the default would render a path under the site base.
    resolveFileUrl({ referenceId, relativePath }) {
      if (!emitted.has(referenceId)) return null
      const relative = relativePath.startsWith('.') ? relativePath : `./${relativePath}`
      return `new URL(${JSON.stringify(relative)}, import.meta.url).href`
    },
  }
}
