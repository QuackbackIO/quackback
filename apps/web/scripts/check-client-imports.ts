/**
 * Guard the browser bundle against imports a browser cannot load.
 *
 * Every chunk under .output/public/assets must import only other chunks
 * (`./x.js`). A bare specifier left in a chunk (`node:url`, `crypto`, a
 * package name) means the bundler externalised it: the browser then refuses
 * the whole chunk, and every page that lazily loads it fails with "Failed to
 * fetch dynamically imported module". The build itself passes, so nothing but
 * the browser notices.
 *
 * Import protection in vite.config.ts refuses Node built-ins at build time;
 * this check reads the built output, so it also catches anything that reaches
 * the browser by another route (an `external` build option, a plugin, a
 * dependency). Imports are read with Bun's parser, so code samples inside
 * strings (the webhook guide's `import crypto from "node:crypto"`) do not count.
 * A relative import must also name a file that exists. A dynamic import whose
 * specifier is computed at runtime cannot be read statically and is not checked;
 * the build emits none for browser code.
 *
 * Run after `bun run build`:
 *   bun run check:client-imports
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ASSETS_DIR = process.argv[2] ?? join(import.meta.dirname, '..', '.output', 'public', 'assets')
const PUBLIC_DIR = dirname(ASSETS_DIR)

if (!existsSync(ASSETS_DIR)) {
  console.error(`check-client-imports: ${ASSETS_DIR} not found. Run \`bun run build\` first.`)
  process.exit(2)
}

/** Where the chunks are served from; only the path matters for resolution. */
const SITE = 'https://site.invalid'

/**
 * Why a chunk's import would fail in the browser, or null when it loads.
 *
 * The specifier is resolved the way the browser resolves it against the
 * chunk's own URL, so `..` stops at the site root and a query or hash is not
 * part of the file. A full URL to another origin (`https://`, `//host`) or a
 * `data:` URL is taken as loadable; anything on this origin must name a file
 * the build emitted. A bare specifier (`node:url`, `react`) is not a URL at all.
 */
function problemWith(spec: string, chunkFile: string): string | null {
  if (/^data:/i.test(spec)) return null
  const isPath = /^(?:\.{0,2}\/)/.test(spec)
  const isUrl = /^[a-z][a-z0-9+.-]*:/i.test(spec)
  if (!isPath && !isUrl) return 'not a URL the browser can fetch'
  let url: URL
  try {
    url = new URL(spec, `${SITE}/assets/${chunkFile}`)
  } catch {
    return 'not a URL the browser can fetch'
  }
  if (url.origin !== SITE) return /^https?:$/.test(url.protocol) ? null : 'not an http(s) URL'
  const file = join(PUBLIC_DIR, decodeURIComponent(url.pathname))
  return existsSync(file) && statSync(file).isFile() ? null : 'no such file'
}

const transpiler = new Bun.Transpiler({ loader: 'js' })
const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))
const problems: string[] = []

for (const file of files) {
  const source = readFileSync(join(ASSETS_DIR, file), 'utf8')
  let imports: ReturnType<typeof transpiler.scanImports>
  try {
    imports = transpiler.scanImports(source)
  } catch (err) {
    problems.push(`  ${file}: not JavaScript the parser can read (${(err as Error).message})`)
    continue
  }
  for (const { path, kind } of imports) {
    const problem = problemWith(path, file)
    if (problem) problems.push(`  ${file}: ${kind} "${path}" (${problem})`)
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
