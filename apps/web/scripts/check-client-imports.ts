/**
 * Guard the browser bundle against imports a browser cannot load.
 *
 * Every chunk under .output/public/assets must import only other chunks
 * (`./x.js`). A bare specifier left in a chunk (`node:url`, `crypto`, a
 * package name) means the bundler externalised it: the browser then refuses
 * the whole chunk, and every page that lazily loads it fails with "Failed to
 * fetch dynamically imported module". That happened on 2026-11-24: an
 * `external: [/^node:/]` build option let config.ts carry `import "node:url"`
 * into the admin roadmap's comment renderer.
 *
 * Import protection in vite.config.ts refuses Node built-ins at build time;
 * this check reads the built output, so it also catches anything that reaches
 * the browser by another route (a new `external`, a plugin, a dependency).
 * Imports are read with Bun's parser, so code samples inside strings (the
 * webhook guide's `import crypto from "node:crypto"`) do not count.
 *
 * Run after `bun run build`:
 *   bun run check:client-imports
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = process.argv[2] ?? join(import.meta.dirname, '..', '.output', 'public', 'assets')

if (!existsSync(ASSETS_DIR)) {
  console.error(`check-client-imports: ${ASSETS_DIR} not found — run \`bun run build\` first.`)
  process.exit(2)
}

/** A specifier the browser resolves on its own: a sibling chunk or a full URL. */
function isLoadable(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec.startsWith('/') ||
    /^https?:\/\//.test(spec) ||
    // The client bundle's lazy-route preloads go through a data: URL.
    spec.startsWith('data:')
  )
}

const transpiler = new Bun.Transpiler({ loader: 'js' })
const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
const problems: string[] = []

for (const file of files) {
  const source = readFileSync(join(ASSETS_DIR, file), 'utf8')
  for (const { path, kind } of transpiler.scanImports(source)) {
    if (!isLoadable(path)) problems.push(`  ${file}: ${kind} "${path}"`)
  }
}

if (problems.length > 0) {
  console.error(
    `check-client-imports: ${problems.length} browser chunk import(s) the browser cannot load:\n` +
      problems.join('\n') +
      '\n\nKeep server-only modules (and Node built-ins) out of code the browser loads. ' +
      'The build output above names the importer; vite.config.ts import protection explains the trace.'
  )
  process.exit(1)
}

console.log(`check-client-imports: ${files.length} browser chunks, every import loadable.`)
