/**
 * The quarantine ledger: every e2e test tagged `@quarantine` has an entry in
 * `apps/web/e2e/QUARANTINE.md`, every entry still matches a quarantined test,
 * and every entry names the PR or issue that will fix it.
 *
 * Pure parsing and checking, no Playwright: the specs are read as text, so the
 * check runs in the unit suite in a second. The test next door
 * (`__tests__/quarantine-ledger.test.ts`) runs it against the real files.
 *
 * Entry format, one list item per quarantined journey (or group of journeys
 * with one cause), under the `## Quarantined tests` heading:
 *
 *     - FBA-I-11 · fix: #1223
 *       `feedback/admin-inbox.spec.ts` › what the test asserts and why it fails.
 *
 * The first line holds the journey ids and the fix: a `#NNN` reference or a
 * GitHub issue or pull request URL.
 */

/** A journey id: FBA-I-16, PPL-AUTH-32, STA-A-30, API-R-071, INT-ON-03. */
const JOURNEY_ID = /[A-Z]+(?:-[A-Z]+)*-\d+/
const LEADING_IDS = new RegExp(`^((?:${JOURNEY_ID.source}[ ,]+)+)`)
const FIX_REFERENCE =
  /(?:^|[\s(,])#\d+\b|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/
const ENTRY_HEADER = /^- (.+?) · fix: (.+)$/

export interface QuarantinedTest {
  file: string
  title: string
  ids: string[]
}

export interface ScanResult {
  tests: QuarantinedTest[]
  /** `@quarantine` tags the scanner could not tie to a test (file and line). */
  unattributed: string[]
  /** Quarantined tests whose title starts with no journey id. */
  withoutId: QuarantinedTest[]
  /** `test.describe` blocks tagged `@quarantine` (tag each test instead). */
  describes: string[]
}

export interface LedgerEntry {
  ids: string[]
  fix: string
  line: number
}

export interface LedgerParse {
  entries: LedgerEntry[]
  /** List items under the heading whose first line is not `- IDS · fix: REF`. */
  malformed: string[]
}

export interface LedgerReport {
  missing: string[]
  stale: string[]
  unowned: string[]
  problems: string[]
}

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/** Index just past the string literal that opens at `start` (', " or `). */
function skipString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') i += 2
    else if (ch === quote) return i + 1
    else if (quote === '`' && ch === '$' && source[i + 1] === '{') i = skipBalanced(source, i + 1)
    else i++
  }
  return i
}

/** Index just past the bracket group that opens at `start` ({, [ or (). */
function skipBalanced(source: string, start: number): number {
  const close: Record<string, string> = { '{': '}', '[': ']', '(': ')' }
  const stack = [close[source[start]]]
  let i = start + 1
  while (i < source.length && stack.length > 0) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipString(source, i)
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (close[ch]) stack.push(close[ch])
    else if (ch === stack[stack.length - 1]) stack.pop()
    i++
  }
  return i
}

const QUARANTINE_TAG = /(['"`])@quarantine\1/g

function tagPositions(text: string, offset: number): number[] {
  return [...text.matchAll(QUARANTINE_TAG)].map((m) => offset + (m.index ?? 0))
}

/**
 * Reads one spec file's source and returns its quarantined tests. A test is
 * quarantined when its options (the object after the title) carry the
 * `@quarantine` tag, directly or through a constant whose value carries it
 * (`const QUARANTINED = { tag: ['@core', '@quarantine'], ... }`).
 */
export function scanSpec(file: string, source: string): ScanResult {
  const result: ScanResult = { tests: [], unattributed: [], withoutId: [], describes: [] }
  const attributed = new Set<number>()

  // Constants whose value carries the tag, e.g. a shared options object.
  const taggedConsts = new Map<string, number[]>()
  for (const m of source.matchAll(/\bconst\s+(\w+)(?:\s*:[^=]+)?\s*=\s*([{[])/g)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const end = skipBalanced(source, open)
    const positions = tagPositions(source.slice(open, end), open)
    if (positions.length > 0) taggedConsts.set(m[1], positions)
  }

  const call =
    /\b(?:test|it)((?:\.(?:describe|only|skip|fixme|fail|slow|serial|parallel))*)\(\s*(['"`])/g
  for (const m of source.matchAll(call)) {
    const titleStart = (m.index ?? 0) + m[0].length - 1
    const titleEnd = skipString(source, titleStart)
    const title = source.slice(titleStart + 1, titleEnd - 1)
    let i = titleEnd
    while (/\s/.test(source[i] ?? '')) i++
    if (source[i] !== ',') continue
    i++
    while (/\s/.test(source[i] ?? '')) i++

    let tagged = false
    if (source[i] === '{') {
      const end = skipBalanced(source, i)
      const options = source.slice(i, end)
      const direct = tagPositions(options, i)
      direct.forEach((p) => attributed.add(p))
      tagged = direct.length > 0
      for (const spread of options.matchAll(/\.\.\.(\w+)/g)) {
        const positions = taggedConsts.get(spread[1])
        if (positions) {
          positions.forEach((p) => attributed.add(p))
          tagged = true
        }
      }
    } else {
      const ident = /^\w+/.exec(source.slice(i))?.[0]
      const positions = ident ? taggedConsts.get(ident) : undefined
      if (positions) {
        positions.forEach((p) => attributed.add(p))
        tagged = true
      }
    }
    if (!tagged) continue

    if (m[1].includes('.describe')) {
      result.describes.push(`${file}:${lineOf(source, m.index ?? 0)} ${title}`)
      continue
    }
    const leading = LEADING_IDS.exec(`${title} `)?.[1] ?? ''
    const ids = leading.match(new RegExp(JOURNEY_ID.source, 'g')) ?? []
    const test = { file, title, ids }
    if (ids.length === 0) result.withoutId.push(test)
    else result.tests.push(test)
  }

  for (const position of tagPositions(source, 0)) {
    if (!attributed.has(position)) result.unattributed.push(`${file}:${lineOf(source, position)}`)
  }
  return result
}

/** Parses the entries under `## Quarantined tests` in QUARANTINE.md. */
export function parseLedger(markdown: string): LedgerParse {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => /^## Quarantined tests\s*$/.test(l))
  const parse: LedgerParse = { entries: [], malformed: [] }
  if (start === -1) {
    parse.malformed.push('QUARANTINE.md has no "## Quarantined tests" heading')
    return parse
  }
  for (let n = start + 1; n < lines.length; n++) {
    const line = lines[n]
    if (/^## /.test(line)) break
    if (!line.startsWith('- ')) continue
    const header = ENTRY_HEADER.exec(line)
    const leading = header ? LEADING_IDS.exec(`${header[1].trim()} `) : null
    if (!header || !leading || leading[1].trim() !== header[1].trim()) {
      parse.malformed.push(`line ${n + 1}: ${line}`)
      continue
    }
    const ids = header[1].match(new RegExp(JOURNEY_ID.source, 'g')) ?? []
    parse.entries.push({ ids, fix: header[2].trim(), line: n + 1 })
  }
  return parse
}

/** Compares the quarantined tests with the ledger. Empty lists mean it holds. */
export function checkLedger(scans: ScanResult[], ledger: LedgerParse): LedgerReport {
  const tests = scans.flatMap((s) => s.tests)
  const quarantined = new Set(tests.flatMap((t) => t.ids))
  const listed = new Set(ledger.entries.flatMap((e) => e.ids))

  const missing = [...quarantined].filter((id) => !listed.has(id)).sort()
  const stale = [...listed].filter((id) => !quarantined.has(id)).sort()
  const unowned = ledger.entries
    .filter((e) => !FIX_REFERENCE.test(e.fix))
    .flatMap((e) => e.ids)
    .sort()

  const problems = [
    ...ledger.malformed.map((m) => `malformed entry (want "- IDS · fix: #NNN"): ${m}`),
    ...scans.flatMap((s) => s.unattributed).map((u) => `@quarantine tag not tied to a test: ${u}`),
    ...scans
      .flatMap((s) => s.withoutId)
      .map(
        (t) =>
          `quarantined test has no journey id at the start of its title: ${t.file} › ${t.title}`
      ),
    ...scans
      .flatMap((s) => s.describes)
      .map((d) => `@quarantine on a describe block, tag each test instead: ${d}`),
  ]
  if (ledger.entries.length > 0 && tests.length === 0) {
    problems.push('QUARANTINE.md lists entries but the scan found no quarantined test')
  }
  return { missing, stale, unowned, problems }
}

/** The failure message, or null when the ledger holds. */
export function describeLedgerReport(report: LedgerReport): string | null {
  const parts: string[] = []
  if (report.missing.length > 0) {
    parts.push(
      `Tagged @quarantine but not in apps/web/e2e/QUARANTINE.md: ${report.missing.join(', ')}. ` +
        'Add an entry that names the fix ("- ID · fix: #NNN").'
    )
  }
  if (report.stale.length > 0) {
    parts.push(
      `In QUARANTINE.md but no test with that id is tagged @quarantine: ${report.stale.join(', ')}. ` +
        'Remove the entry (the quarantine was lifted) or fix the id.'
    )
  }
  if (report.unowned.length > 0) {
    parts.push(
      `QUARANTINE.md entries that name no fix PR or issue: ${report.unowned.join(', ')}. ` +
        'Write "fix: #NNN" (or a GitHub issue or pull request URL); open an issue if there is no PR yet.'
    )
  }
  parts.push(...report.problems)
  return parts.length > 0 ? parts.join('\n') : null
}
