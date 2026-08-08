/**
 * No publicly cacheable response may omit `Vary: Host`.
 *
 * Under pooled tenancy the `Host` header chooses the database, so every route
 * path is shared by every tenant while the body is not. An origin server's own
 * cache keys on the authority, but a CDN does not have to — and the plan puts
 * one in front of this fleet. A host-agnostic cache key there produces
 * `SAAS-HOSTING-STACK.md` §3 through the edge instead of through the pool:
 * tenant A's branding, widget config or asset served to tenant B, nothing
 * erroring, nothing in the application logs.
 *
 * A source scan rather than a response assertion, deliberately. Asserting on
 * the handlers we remembered to test would only cover the ones we already
 * thought about; the risk is the *next* cacheable route, written by someone who
 * has not read this file. This is the same shape as the repo's existing
 * `dep-graph` and `authz-matrix` scanners.
 *
 * The allowlist is for responses that genuinely do not vary by tenant. It is
 * empty today, and adding an entry should require saying why in the entry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../routes')

/** Responses that are byte-identical for every tenant. Justify every entry. */
const ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = []

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) acc.push(full)
  }
  return acc
}

/**
 * A file "declares a public cache" if it emits `public, max-age=` or
 * `s-maxage=`. It "varies on Host" if a `Vary` value in the same file names
 * Host, or it builds its headers through the shared helper.
 */
function scan(text: string): { cacheable: boolean; variesOnHost: boolean } {
  const stripped = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const cacheable = /public,\s*max-age=|s-maxage=/.test(stripped)
  const variesOnHost =
    /Vary['"]?\s*:\s*['"`][^'"`]*Host/i.test(stripped) ||
    /publicTenantCacheHeaders\s*\(/.test(stripped)
  return { cacheable, variesOnHost }
}

describe('publicly cacheable responses vary on Host', () => {
  const files = sourceFiles(ROUTES_DIR)

  it('found routes to scan at all', () => {
    // Without this, a broken path would make the whole suite pass by scanning
    // nothing — the exact "test that could not have failed" shape.
    expect(files.length).toBeGreaterThan(50)
  })

  it('every cacheable route declares Vary: Host', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(ROUTES_DIR, file)
      if (ALLOWLIST.some((a) => a.file === rel)) continue
      const { cacheable, variesOnHost } = scan(readFileSync(file, 'utf8'))
      if (cacheable && !variesOnHost) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('actually finds the cacheable routes it is meant to be guarding', () => {
    // The previous assertion passes trivially if the regex matches nothing.
    // Pin the count so a change that stops detecting `public, max-age` is loud.
    const cacheableCount = files.filter((f) => scan(readFileSync(f, 'utf8')).cacheable).length
    expect(cacheableCount).toBeGreaterThanOrEqual(7)
  })
})

describe('publicTenantCacheHeaders', () => {
  it('always includes Host, first', async () => {
    const { publicTenantCacheHeaders } = await import('../http-cache')
    expect(publicTenantCacheHeaders(60)).toEqual({
      'Cache-Control': 'public, max-age=60',
      Vary: 'Host',
    })
    expect(publicTenantCacheHeaders(3600, 'Accept-Encoding')).toEqual({
      'Cache-Control': 'public, max-age=3600',
      Vary: 'Host, Accept-Encoding',
    })
  })
})
