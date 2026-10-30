/**
 * Computed-style snapshots of the portal, in light and dark.
 *
 * A theme or CSS change that should leave the portal looking the same can
 * prove it: snapshot before, snapshot after, compare. Each page records every
 * element's computed values for the properties a theme drives, keyed by the
 * element's position in the document, so a matching document compares element
 * by element.
 *
 *   bun perf/style-snap.ts --out before.json
 *   bun perf/style-snap.ts --out after.json --compare before.json
 *   bun perf/style-snap.ts --compare before.json --against after.json   (no server)
 *
 * Boots the production build against the bench database, like bench.ts
 * (`bun run build` and `bun perf/setup-db.ts` first). Exit code 1 means a
 * comparison found a difference or a page failed to load.
 */
import { chromium, type Browser, type Page } from '@playwright/test'
import postgres from 'postgres'
import { fromUuid } from '@quackback/ids'
import { BENCH_DATABASE_URL, BENCH_URL, startBenchServer } from './config'

/** The properties a portal theme can change. */
const PROPERTIES = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'box-shadow',
  'outline-color',
  'color-scheme',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'row-gap',
  'column-gap',
] as const

type ElementStyles = Record<string, string>
/** Page label -> element path -> styles. */
type Snapshot = Record<string, Record<string, ElementStyles>>

const MODES = ['light', 'dark'] as const

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function query<T>(run: (sql: postgres.Sql) => Promise<unknown>): Promise<T[]> {
  const sql = postgres(BENCH_DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    return (await run(sql)) as T[]
  } finally {
    await sql.end()
  }
}

/** The newest published changelog entry's public page. */
async function latestChangelogPath(): Promise<string> {
  const [row] = await query<{ id: string }>(
    (sql) => sql`
      SELECT id FROM changelog_entries
      WHERE published_at <= now() AND deleted_at IS NULL
      ORDER BY published_at DESC, id LIMIT 1`
  )
  if (!row) throw new Error('no published changelog entry')
  return `/changelog/${fromUuid('changelog', row.id)}`
}

/** The first post the public feed links to, as a visitor would open it. */
async function firstPostPath(browser: Browser): Promise<string> {
  const page = await browser.newPage({ baseURL: BENCH_URL })
  try {
    await page.goto('/?sort=trending', { waitUntil: 'networkidle' })
    const href = await page.locator('a[href*="/posts/post_"]').first().getAttribute('href')
    if (!href) throw new Error('the feed links to no post')
    return href
  } finally {
    await page.close()
  }
}

const PAGES: (string | ((browser: Browser) => Promise<string>))[] = [
  '/?sort=trending',
  '/roadmap',
  '/changelog',
  latestChangelogPath,
  firstPostPath,
  '/hc',
  '/auth/reset-password',
  '/widget',
]

/** Every element's styles, keyed by its child-index path from <html>. */
async function readStyles(page: Page): Promise<Record<string, ElementStyles>> {
  return page.evaluate(
    (properties) => {
      const out: Record<string, Record<string, string>> = {}
      const walk = (element: Element, path: string) => {
        const computed = getComputedStyle(element)
        const styles: Record<string, string> = {}
        for (const property of properties) styles[property] = computed.getPropertyValue(property)
        out[`${path} ${element.tagName.toLowerCase()}`] = styles
        Array.from(element.children).forEach((child, index) => {
          if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK')
            return
          walk(child, `${path}/${index}`)
        })
      }
      walk(document.documentElement, '')
      return out
    },
    PROPERTIES as unknown as string[]
  )
}

async function snapshot(browser: Browser): Promise<Snapshot> {
  const result: Snapshot = {}
  const paths: string[] = []
  for (const p of PAGES) paths.push(typeof p === 'string' ? p : await p(browser))
  for (const mode of MODES) {
    const context = await browser.newContext({
      baseURL: BENCH_URL,
      colorScheme: mode,
      reducedMotion: 'reduce',
      timezoneId: 'UTC',
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    })
    for (const path of paths) {
      const page = await context.newPage()
      const response = await page.goto(path, { waitUntil: 'networkidle' })
      if (!response?.ok()) throw new Error(`${path} answered ${response?.status()}`)
      await page.addStyleTag({
        content: '*,*::before,*::after{transition:none!important;animation:none!important}',
      })
      await page.evaluate(() => document.fonts.ready)
      result[`${mode} ${path}`] = await readStyles(page)
      await page.close()
    }
    await context.close()
  }
  return result
}

/** Every difference between two snapshots, one line each. */
function compare(before: Snapshot, after: Snapshot): string[] {
  const lines: string[] = []
  for (const label of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[label]
    const b = after[label]
    if (!a || !b) {
      lines.push(`${label}: page ${a ? 'missing after' : 'new'}`)
      continue
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!a[key] || !b[key]) {
        lines.push(`${label} ${key}: element ${a[key] ? 'removed' : 'added'}`)
        continue
      }
      for (const property of PROPERTIES) {
        if (a[key][property] !== b[key][property])
          lines.push(`${label} ${key} ${property}: ${a[key][property]} -> ${b[key][property]}`)
      }
    }
  }
  return lines
}

const out = arg('out')
const comparePath = arg('compare')
const againstPath = arg('against')
const appDir = process.env.PERF_APP_DIR ?? new URL('..', import.meta.url).pathname

let current: Snapshot
if (againstPath) {
  current = await Bun.file(againstPath).json()
} else {
  const server = await startBenchServer(appDir, { env: { TZ: 'UTC', LOG_LEVEL: 'warn' } })
  try {
    const browser = await chromium.launch()
    current = await snapshot(browser)
    await browser.close()
  } finally {
    server.kill()
  }
  if (out) await Bun.write(out, JSON.stringify(current))
  const elements = Object.values(current).reduce((n, page) => n + Object.keys(page).length, 0)
  console.log(`snapshot: ${Object.keys(current).length} pages, ${elements} elements`)
}

if (comparePath) {
  // The comparison must be able to fail: one changed value has to be reported.
  const [label] = Object.keys(current)
  const [key] = Object.keys(current[label])
  const altered = structuredClone(current)
  altered[label][key].color = `${altered[label][key].color} (altered)`
  if (compare(current, altered).length !== 1) {
    console.log('self-test: a changed value was not reported')
    process.exit(1)
  }
  const differences = compare(await Bun.file(comparePath).json(), current)
  for (const line of differences.slice(0, 200)) console.log(line)
  if (differences.length > 200) console.log(`... and ${differences.length - 200} more`)
  console.log(differences.length ? `${differences.length} differences` : 'no differences')
  process.exit(differences.length ? 1 : 0)
}
