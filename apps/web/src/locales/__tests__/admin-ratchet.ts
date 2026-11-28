/**
 * The method behind the admin ratchet tests (English in code, left/right
 * classes): count the problems in each admin file and compare the counts with
 * a baseline saved beside the test. A count may go down, never up, and a file
 * the baseline does not list must have none. `bun run i18n:baseline` writes a
 * lower baseline after a change removes problems; it never raises a count.
 *
 * Sources are parsed with @babel/parser (TypeScript and JSX), so a scan reads
 * real syntax: JSX text, attributes, calls and string literals, never comments.
 * Paths are relative to `apps/web/src`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse, type ParserPlugin } from '@babel/parser'

export type Node = { type: string; loc?: { start: { line: number } }; [key: string]: unknown }

export const SRC_ROOT = join(import.meta.dirname, '..', '..')

/**
 * What the admin renders from: its routes and components, the shared parts it
 * shows (dialogs, menus, pickers, conversation views, settings forms,
 * notifications), the integration catalogue and the client hooks that raise
 * toasts.
 */
export const ADMIN_SOURCE_DIRS = [
  'routes/admin',
  'components/admin',
  'components/shared',
  'components/ui',
  'components/conversation',
  'components/settings',
  'components/integrations',
  'components/notifications',
  'integrations',
  'lib/client',
] as const

export const ADMIN_SOURCE_FILES = ['routes/admin.tsx'] as const

const SKIP = /(^|\/)(__tests__|node_modules)(\/|$)|\.(test|spec|stories)\.tsx?$|\.d\.ts$/

function walkDir(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const rel = relative(SRC_ROOT, path)
    if (SKIP.test(rel)) continue
    if (statSync(path).isDirectory()) walkDir(path, out)
    else if (/\.tsx?$/.test(name)) out.push(rel)
  }
}

/** The admin source files, relative to `apps/web/src`, sorted. */
export function adminSourceFiles(): string[] {
  const out: string[] = []
  for (const dir of ADMIN_SOURCE_DIRS) {
    const path = join(SRC_ROOT, dir)
    if (existsSync(path)) walkDir(path, out)
  }
  for (const file of ADMIN_SOURCE_FILES) {
    if (existsSync(join(SRC_ROOT, file))) out.push(file)
  }
  return [...new Set(out)].sort()
}

const SKIPPED_KEYS = new Set([
  'loc',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
])

/** Visits every node below `node`, parents before children; `visit` returning false skips a subtree. */
export function walk(node: unknown, visit: (node: Node, parent: Node | null) => boolean | void) {
  const go = (current: unknown, parent: Node | null): void => {
    if (Array.isArray(current)) {
      for (const child of current) go(child, parent)
      return
    }
    if (!current || typeof current !== 'object' || typeof (current as Node).type !== 'string') {
      return
    }
    if (visit(current as Node, parent) === false) return
    for (const [key, child] of Object.entries(current)) {
      if (!SKIPPED_KEYS.has(key) && child && typeof child === 'object') go(child, current as Node)
    }
  }
  go(node, null)
}

/** The program of a source, or null when it does not parse. */
export function parseSource(source: string, file: string): Node | null {
  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript']
  try {
    return parse(source, { sourceType: 'module', plugins }) as unknown as Node
  } catch {
    return null
  }
}

/** One problem a scan found. */
export interface Finding {
  line: number
  /** What to show: the text, or the class and its logical form. */
  text: string
}

export type Scan = (source: string, file: string) => Finding[]

export type Baseline = Record<string, number>

/** Each scanned file's findings, for the files that have any. */
export function scanFiles(scan: Scan, files: readonly string[]): Map<string, Finding[]> {
  const found = new Map<string, Finding[]>()
  for (const file of files) {
    const findings = scan(readFileSync(join(SRC_ROOT, file), 'utf8'), file)
    if (findings.length > 0) found.set(file, findings)
  }
  return found
}

export function countsOf(found: Map<string, Finding[]>): Baseline {
  const counts: Baseline = {}
  for (const [file, findings] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    counts[file] = findings.length
  }
  return counts
}

/** A file whose count is above its baseline (a new file's baseline is 0). */
export interface Regression {
  file: string
  count: number
  baseline: number
  findings: Finding[]
}

export interface Comparison {
  regressions: Regression[]
  /** Files whose count went down (or that are gone) while the baseline still says more. */
  stale: string[]
}

export function compareWithBaseline(found: Map<string, Finding[]>, baseline: Baseline): Comparison {
  const regressions: Regression[] = []
  for (const [file, findings] of found) {
    const allowed = baseline[file] ?? 0
    if (findings.length > allowed) {
      regressions.push({ file, count: findings.length, baseline: allowed, findings })
    }
  }
  const stale = Object.entries(baseline)
    .filter(([file, allowed]) => (found.get(file)?.length ?? 0) < allowed)
    .map(([file]) => file)
  return { regressions, stale }
}

/**
 * The baseline after a change: each count lowered to today's, files with none
 * (or gone) dropped. A count that went up, or a file the baseline does not
 * list, keeps its old allowance; the test reports it.
 */
export function lowerBaseline(baseline: Baseline, counts: Baseline): Baseline {
  const lowered: Baseline = {}
  for (const file of Object.keys(baseline).sort()) {
    const count = Math.min(baseline[file]!, counts[file] ?? 0)
    if (count > 0) lowered[file] = count
  }
  return lowered
}

export function formatBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`
}

export function readBaseline(path: string): Baseline {
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline
}
