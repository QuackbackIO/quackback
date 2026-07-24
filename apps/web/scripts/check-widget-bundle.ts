/**
 * Guard the embeddable widget's eager JS payload.
 *
 * The /widget iframe loads on every host page that embeds the widget, so the
 * JS it fetches before first paint must stay small. That payload is the
 * static-import closure of the app ENTRY (loaded by every document — routeTree
 * plus route config/loader halves) plus the widget route's split component
 * chunks (dynamically imported by the entry when the route matches).
 *
 * This once regressed silently to ~1.7 MB gzipped: directory-pinned
 * manualChunks made rolldown place entry-shared helper modules inside the
 * admin chunks, giving the entry an eager import edge into the whole admin
 * app. Pinning is gone (see vite.config.ts); this script keeps the graph
 * honest. Run after `bun run build`:
 *   bun run check:widget-bundle
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ASSETS_DIR = join(import.meta.dirname, '..', '.output', 'public', 'assets')

/** Total gzipped budget for the widget's eager chunk graph (entry + route). */
const BUDGET_GZIP_BYTES = 550 * 1024
/**
 * Content markers for heavy libraries that must only ever load behind lazy
 * boundaries (rich-text editor, charts). Checked against eager chunk contents
 * so renames can't dodge the guard.
 */
const FORBIDDEN_CONTENT = ['ProseMirror', 'recharts']

if (!existsSync(ASSETS_DIR)) {
  console.error(`check-widget-bundle: ${ASSETS_DIR} not found — run \`bun run build\` first.`)
  process.exit(2)
}

const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.js'))

/** Static (eager) same-dir imports of a chunk: `from"./x.js"` and bare
 *  `import"./x.js"`. Dynamic `import("./x.js")` is deliberately excluded —
 *  lazy boundaries are the point. */
function eagerImports(source: string): string[] {
  const out = new Set<string>()
  for (const match of source.matchAll(/(?:from|import)["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]/g)) {
    out.add(match[1])
  }
  return [...out]
}

/** Dynamic imports of a chunk: import("./x.js") — rolldown may emit any quote style. */
function dynamicImports(source: string): string[] {
  const out = new Set<string>()
  for (const match of source.matchAll(/import\(["'`]\.\/([A-Za-z0-9._-]+\.js)["'`]\)/g)) {
    out.add(match[1])
  }
  return [...out]
}

// The entry is the index-* chunk that hydrates the document (route index.tsx
// splits are also named index-*, but only the client entry calls hydrateRoot).
const entry = files.find(
  (f) => /^index-/.test(f) && readFileSync(join(ASSETS_DIR, f), 'utf-8').includes('hydrateRoot')
)
if (!entry) {
  console.error('check-widget-bundle: could not identify the client entry chunk.')
  process.exit(2)
}

// The widget route's split chunks: dynamic imports of the entry whose names
// come from the widget route files (widget.tsx, widget/index.tsx → widget-*).
const entrySource = readFileSync(join(ASSETS_DIR, entry), 'utf-8')
const widgetRouteChunks = dynamicImports(entrySource).filter((f) => /^widget[.-]/.test(f))
if (widgetRouteChunks.length === 0) {
  console.error('check-widget-bundle: no widget route chunks found among entry dynamic imports.')
  process.exit(2)
}

const seen = new Map<string, { raw: number; gzip: number; content: string }>()
const queue = [entry, ...widgetRouteChunks]
while (queue.length > 0) {
  const name = queue.pop()!
  if (seen.has(name)) continue
  const path = join(ASSETS_DIR, name)
  if (!existsSync(path)) continue
  const content = readFileSync(path)
  const text = content.toString('utf-8')
  seen.set(name, { raw: content.byteLength, gzip: gzipSync(content).byteLength, content: text })
  for (const imported of eagerImports(text)) {
    if (!seen.has(imported)) queue.push(imported)
  }
}

const totalRaw = [...seen.values()].reduce((sum, s) => sum + s.raw, 0)
const totalGzip = [...seen.values()].reduce((sum, s) => sum + s.gzip, 0)
const contaminated = [...seen.entries()]
  .map(([name, { content }]) => ({
    name,
    markers: FORBIDDEN_CONTENT.filter((marker) => content.includes(marker)),
  }))
  .filter((c) => c.markers.length > 0)

const top = [...seen.entries()].sort((a, b) => b[1].gzip - a[1].gzip).slice(0, 10)
console.log(
  `Widget eager chunk graph (${entry} + ${widgetRouteChunks.join(', ')}): ${seen.size} chunks`
)
for (const [name, { raw, gzip }] of top) {
  console.log(
    `  ${(gzip / 1024).toFixed(1).padStart(7)} KB gz  ${(raw / 1024).toFixed(0).padStart(5)} KB raw  ${name}`
  )
}
console.log(
  `Total: ${(totalRaw / 1024).toFixed(0)} KB raw, ${(totalGzip / 1024).toFixed(0)} KB gzipped ` +
    `(budget ${(BUDGET_GZIP_BYTES / 1024).toFixed(0)} KB gz)`
)

let failed = false
if (contaminated.length > 0) {
  console.error(
    '\nFAIL: heavy lazy-only libraries are eagerly reachable from the widget:\n' +
      contaminated.map((c) => `  ${c.name} (${c.markers.join(', ')})`).join('\n')
  )
  failed = true
}
if (totalGzip > BUDGET_GZIP_BYTES) {
  console.error(
    `\nFAIL: widget eager payload ${(totalGzip / 1024).toFixed(0)} KB gz exceeds the ` +
      `${(BUDGET_GZIP_BYTES / 1024).toFixed(0)} KB budget.`
  )
  failed = true
}
process.exit(failed ? 1 : 0)
