/**
 * The billing module does not name its vendor outside wire values.
 *
 * `CLAUDE.md` forbids naming third-party products in source and comments, and
 * its carve-out for products we genuinely integrate with is scoped to
 * `apps/web/src/integrations/**` — which this module is deliberately not part
 * of. So the rule applies here in full.
 *
 * The exception is protocol: the API host, the signature header and the
 * provider's own form field names are defined by the provider, not chosen by
 * us, and changing their spelling would break the integration. Those are
 * enumerated below rather than pattern-matched, so a new one has to be added
 * consciously.
 */
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { walkSourceFiles } from '@/lib/server/policy/source-files'

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Lines allowed to carry the vendor name, by exact content.
 *
 * Exact strings, not a regex: a loose pattern would exempt any line that
 * happened to mention the API host, which is how these lists rot.
 */
const WIRE_VALUE_LINES = new Set([
  `export const SIGNATURE_HEADER = 'stripe-signature'`,
  `const API_ROOT = 'https://api.stripe.com/v1'`,
  `['payload[stripe_customer_id]', input.customer],`,
])

/** Case-insensitive, so a capitalised mention in prose is caught too. */
const VENDOR = /stripe/i

function offendingLines(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => VENDOR.test(line) && !WIRE_VALUE_LINES.has(line))
}

describe('billing module vendor naming', () => {
  it('scans a module that exists', () => {
    // The precondition. A wrong root scans nothing and reports no offenders.
    const files = walkSourceFiles(MODULE_ROOT)
    expect(files.length).toBeGreaterThan(5)
  })

  it('names the vendor only on wire-value lines', () => {
    const offenders: Array<{ file: string; line: string }> = []
    for (const file of walkSourceFiles(MODULE_ROOT)) {
      for (const line of offendingLines(readFileSync(file, 'utf8'))) {
        offenders.push({ file: relative(MODULE_ROOT, file), line })
      }
    }
    // File AND line, so a failure is actionable without a grep.
    expect(offenders).toEqual([])
  })

  it('still carries the wire values it needs', () => {
    // The inverse: "no vendor names" must not be satisfiable by deleting the
    // protocol constants, which would break every provider call silently.
    const client = readFileSync(resolve(MODULE_ROOT, 'provider/client.ts'), 'utf8')
    const webhook = readFileSync(resolve(MODULE_ROOT, 'webhook.service.ts'), 'utf8')
    expect(client).toContain(`const API_ROOT = 'https://api.stripe.com/v1'`)
    expect(webhook).toContain(`export const SIGNATURE_HEADER = 'stripe-signature'`)
  })

  it('detects a name when one is present', () => {
    // Proves the matcher is not simply never matching.
    expect(offendingLines(`// talks to Stripe`)).toEqual(['// talks to Stripe'])
    expect(offendingLines(`const x = 1`)).toEqual([])
  })
})
