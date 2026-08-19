/**
 * Guard against server functions that crash the moment server code calls them.
 *
 * The build emits a resolver manifest keyed by server-function ID, and it only
 * contains the functions the CLIENT bundle references. A `createServerFn` that
 * no client module imports still compiles its server-side callers down to a
 * `createSsrRpc("<id>")` stub, and that stub resolves through the same
 * manifest — so the call throws `Server function info not found for <id>` at
 * runtime, in production builds only.
 *
 * Anything called only from the server should be a plain async function
 * instead. This script fails the build when a server-side call site survives
 * for an ID the manifest cannot resolve. Unused server functions are
 * tree-shaken out of the server bundle, so they never reach this check.
 *
 * Run after `bun run build`:
 *   bun run check:server-fn-manifest
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SERVER_DIR = join(import.meta.dirname, '..', '.output', 'server')

/** Manifest entry: `"<id>": { functionName: "<name>", ... }`. */
const MANIFEST_ENTRY = /"([0-9a-f]{64}(?:_\d+)?)":\s*\{\s*functionName:\s*"([^"]+)"/g
/** Server-side call site emitted for a `createServerFn` caller. */
const SSR_RPC_CALL = /createSsrRpc\(\s*"([0-9a-f]{64}(?:_\d+)?)"\s*\)/g

if (!existsSync(SERVER_DIR)) {
  console.error(`check-server-fn-manifest: ${SERVER_DIR} not found — run \`bun run build\` first.`)
  process.exit(2)
}

function serverFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...serverFiles(path))
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

const manifestIds = new Set<string>()
/** id -> the server chunks that call it, so a failure names a real call site. */
const callSites = new Map<string, Set<string>>()

for (const file of serverFiles(SERVER_DIR)) {
  const source = readFileSync(file, 'utf8')
  for (const [, id] of source.matchAll(MANIFEST_ENTRY)) manifestIds.add(id)
  for (const [, id] of source.matchAll(SSR_RPC_CALL)) {
    const files = callSites.get(id) ?? new Set<string>()
    files.add(file.slice(SERVER_DIR.length + 1))
    callSites.set(id, files)
  }
}

if (manifestIds.size === 0) {
  console.error('check-server-fn-manifest: no server-function manifest found in the build output.')
  process.exit(2)
}

const unresolvable = [...callSites].filter(([id]) => !manifestIds.has(id))

if (unresolvable.length > 0) {
  console.error(
    `check-server-fn-manifest: ${unresolvable.length} server function(s) are called from server code but missing from the manifest.\n` +
      'Each call throws "Server function info not found" at runtime. Convert them to plain async functions.\n'
  )
  for (const [id, files] of unresolvable) {
    console.error(`  ${id}\n    called from: ${[...files].sort().join(', ')}`)
  }
  process.exit(1)
}

console.log(
  `check-server-fn-manifest: OK — ${callSites.size} server-side call site(s) all resolve against ${manifestIds.size} manifest entries.`
)
