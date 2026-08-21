/**
 * No publicly cacheable response may omit `Vary: Host`.
 *
 * Under pooled tenancy the `Host` header chooses the database, so every route
 * path is shared by every workspace while the body is not. An origin server's own
 * cache keys on the authority, but a CDN does not have to — and the plan puts
 * one in front of this fleet. A host-agnostic cache key there produces
 * `SAAS-HOSTING-STACK.md` §3 through the edge instead of through the pool:
 * workspace A's branding, widget config or asset served to workspace B, nothing
 * erroring, nothing in the application logs.
 *
 * A source scan rather than a response assertion, deliberately. Asserting on
 * the handlers we remembered to test would only cover the ones we already
 * thought about; the risk is the *next* cacheable route, written by someone who
 * has not read this file. This is the same shape as the repo's existing
 * `dep-graph` and `authz-matrix` scanners.
 *
 * The allowlist is for responses that genuinely do not vary by workspace. It is
 * empty today, and adding an entry should require saying why in the entry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../routes')

/** Responses that are byte-identical for every workspace. Justify every entry. */
const ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = []

function sourceFiles(dir: string, acc: string[] = []): string[] {
  // A missing directory returns nothing rather than throwing, so a moved route
  // tree fails the "found routes to scan at all" assertion below with a legible
  // message instead of crashing collection — which reads as an infrastructure
  // problem rather than as the guard reporting that it has gone blind.
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) acc.push(full)
  }
  return acc
}

/**
 * Scanned **per response**, not per file.
 *
 * A file-level check is not good enough, and this is not a hypothetical: a
 * scripted edit once put both `Vary` lines into a route's private-portal branch
 * — which returns an empty body — while the main response, the one every
 * crawler and CDN actually receives, got none. The file contained the string
 * `Vary: 'Host'`, so a file-level regex passed it, and the guard reported green
 * on a route that was live and wrong.
 *
 * So each `Cache-Control` occurrence is judged against the header object it
 * sits in: walk out to the enclosing `{ … }` and require `Vary` (or the shared
 * helper) *there*. The helper alone also counts, because it emits both keys
 * together and cannot be split apart the way two hand-written lines can.
 */
export interface CacheableResponse {
  /** 1-based line of the Cache-Control (or helper) occurrence. */
  line: number
  variesOnHost: boolean
}

function stripComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The `{ … }` object literal containing `index`, found by brace balance. */
function enclosingObject(text: string, index: number): string {
  let depth = 0
  let start = -1
  for (let i = index; i >= 0; i--) {
    const ch = text[i]
    if (ch === '}') depth++
    else if (ch === '{') {
      if (depth === 0) {
        start = i
        break
      }
      depth--
    }
  }
  if (start < 0) return ''
  depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

export function scanResponses(text: string): CacheableResponse[] {
  const stripped = stripComments(text)
  const out: CacheableResponse[] = []
  // The helper emits Cache-Control and Vary together, so it is its own witness.
  const helper = /publicWorkspaceCacheHeaders\s*\(/g
  for (const m of stripped.matchAll(helper)) {
    out.push({ line: lineOf(stripped, m.index ?? 0), variesOnHost: true })
  }
  const literal = /['"`]?Cache-Control['"`]?\s*:\s*[^,\n]*(?:public,\s*max-age=|s-maxage=)/gi
  for (const m of stripped.matchAll(literal)) {
    const obj = enclosingObject(stripped, m.index ?? 0)
    out.push({
      line: lineOf(stripped, m.index ?? 0),
      variesOnHost: /Vary['"`]?\s*:\s*['"`][^'"`]*Host/i.test(obj),
    })
  }
  return out
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

describe('publicly cacheable responses vary on Host', () => {
  const files = sourceFiles(ROUTES_DIR)

  it('found routes to scan at all', () => {
    // Without this, a broken path would make the whole suite pass by scanning
    // nothing — the exact "test that could not have failed" shape.
    expect(files.length).toBeGreaterThan(50)
  })

  it('every cacheable RESPONSE declares Vary: Host', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(ROUTES_DIR, file)
      if (ALLOWLIST.some((a) => a.file === rel)) continue
      for (const r of scanResponses(readFileSync(file, 'utf8'))) {
        if (!r.variesOnHost) offenders.push(`${rel}:${r.line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('actually finds the cacheable responses it is meant to be guarding', () => {
    // The previous assertion passes trivially if the regex matches nothing.
    // Pin the count so a change that stops detecting them is loud.
    const total = files.reduce((n, f) => n + scanResponses(readFileSync(f, 'utf8')).length, 0)
    expect(total).toBeGreaterThanOrEqual(10)
  })
})

describe('the scanner judges each response, not each file', () => {
  // The shape that got through: one branch carries Vary, the branch that serves
  // the cacheable body does not. A file-level check sees the string and passes.
  const MIXED = `
    export const handler = async () => {
      if (isPrivate) {
        return new Response('', {
          headers: { 'Cache-Control': 'public, max-age=3600', Vary: 'Host' },
        })
      }
      return new Response(body, {
        headers: { 'Cache-Control': 'public, max-age=3600' },
      })
    }
  `

  it('flags the response that omits Vary even when a sibling branch has it', () => {
    const results = scanResponses(MIXED)
    expect(results).toHaveLength(2)
    expect(results.filter((r) => !r.variesOnHost)).toHaveLength(1)
  })

  it('passes a file where every cacheable response carries Vary', () => {
    const ok = MIXED.replace(
      "headers: { 'Cache-Control': 'public, max-age=3600' },",
      "headers: { 'Cache-Control': 'public, max-age=3600', Vary: 'Host' },"
    )
    expect(scanResponses(ok).every((r) => r.variesOnHost)).toBe(true)
  })

  it('does not credit a Vary that sits in a different object in the same file', () => {
    const decoy = `
      const unrelated = { Vary: 'Host' }
      const res = new Response(b, { headers: { 'Cache-Control': 'public, max-age=60' } })
    `
    expect(scanResponses(decoy).some((r) => !r.variesOnHost)).toBe(true)
  })
})

describe('publicWorkspaceCacheHeaders', () => {
  it('always includes Host, first', async () => {
    const { publicWorkspaceCacheHeaders } = await import('../http-cache')
    expect(publicWorkspaceCacheHeaders(60)).toEqual({
      'Cache-Control': 'public, max-age=60',
      Vary: 'Host',
    })
    expect(publicWorkspaceCacheHeaders(3600, 'Accept-Encoding')).toEqual({
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Host, Accept-Encoding',
    })
  })
})
