/**
 * Guard every server-function call site in the built server bundle against the
 * generated server-function manifest.
 *
 * The build splits each `createServerFn` into two halves: the declaring module
 * keeps a caller stub `createSsrRpc("<id>")`, and the handler is extracted into
 * a provider module that the generated manifest maps the id to. At request time
 * `getServerFnById(id)` looks the id up in that manifest; a call site whose id
 * is absent throws `Server function info not found for <id>` and the route
 * returns a 500.
 *
 * The manifest is only as complete as what the compiler had registered when it
 * emitted the resolver module, which is why a dropped entry is invisible until
 * a request actually reaches that server function in production — dev resolves
 * ids by decoding them, with no manifest involved.
 *
 * This compares the two sides of the built output directly, so a dropped entry
 * fails the build instead of the page. Only call sites that survived bundling
 * are checked, so unreferenced declarations (never emitted, never callable)
 * cannot produce a false positive. Run after `bun run build`:
 *   bun run check:server-fn-manifest
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SERVER_DIR = join(import.meta.dirname, '..', '.output', 'server')

/** Caller stubs the compiler emits into the server bundle: createSsrRpc("<id>"). */
const CALL_SITE_RE = /createSsrRpc\("([0-9a-f]{64})"\)/g
/** Entries of the generated resolver manifest: "<id>": { functionName: ... }. */
const MANIFEST_ENTRY_RE = /"([0-9a-f]{64})":\s*\{\s*functionName:/g

if (!existsSync(SERVER_DIR)) {
  console.error(`check-server-fn-manifest: ${SERVER_DIR} not found — run \`bun run build\` first.`)
  process.exit(2)
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, acc)
    else if (/\.(mjs|js)$/.test(entry.name)) acc.push(path)
  }
  return acc
}

/** id -> first bundle file that calls it, for a diagnosable failure message. */
const callSites = new Map<string, string>()
const manifest = new Set<string>()

for (const file of walk(SERVER_DIR)) {
  const source = readFileSync(file, 'utf-8')
  for (const match of source.matchAll(CALL_SITE_RE)) {
    if (!callSites.has(match[1])) callSites.set(match[1], file)
  }
  for (const match of source.matchAll(MANIFEST_ENTRY_RE)) manifest.add(match[1])
}

if (manifest.size === 0) {
  console.error(
    'check-server-fn-manifest: no manifest entries found in the server bundle. ' +
      'The manifest shape this guard matches has changed — update MANIFEST_ENTRY_RE.'
  )
  process.exit(2)
}
if (callSites.size === 0) {
  console.error(
    'check-server-fn-manifest: no server-function call sites found in the server bundle. ' +
      'The caller-stub shape this guard matches has changed — update CALL_SITE_RE.'
  )
  process.exit(2)
}

const orphans = [...callSites].filter(([id]) => !manifest.has(id))

console.log(
  `Server-function manifest: ${manifest.size} entries, ${callSites.size} call sites in the server bundle`
)

if (orphans.length > 0) {
  console.error(
    `\nFAIL: ${orphans.length} server function(s) are called by the server bundle but missing ` +
      `from the manifest. Each one is a 500 on any request that reaches it:\n` +
      orphans.map(([id, file]) => `  ${id}\n    called from ${file}`).join('\n') +
      `\n\nA server function reached only from server code (an SSR loader, another server ` +
      `function, an API route handler) is never registered while the client graph is compiled, ` +
      `and the manifest is emitted from those registrations. Such a function does not need the ` +
      `RPC hop at all — call it as a plain async function instead of declaring it with ` +
      `createServerFn.`
  )
  process.exit(1)
}

process.exit(0)
