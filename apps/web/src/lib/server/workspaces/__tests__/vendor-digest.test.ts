/**
 * The vendored contract files change only on purpose.
 *
 * `tenancy/vendor/` is copied from the control plane so both repos run the same
 * predicate over the same record. Several modules rely on that copy staying
 * put — `quarantine.ts` string-matches refusal codes on the explicit premise
 * that "the parity test is what keeps the strings honest". This is that test:
 * a digest per vendored file, so any edit — deliberate re-vendor or accidental
 * drift — shows up as a reviewed snapshot change rather than a silent one.
 *
 * When a re-vendor lands, update the digest alongside it and check the
 * control-plane counterpart carries the same semantic change.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const VENDOR_DIR = join(import.meta.dirname, '..', 'vendor')

const EXPECTED: Record<string, string> = {
  'contract.ts': '59d16295b3f1d4a0379a8e0c65838f531afbbb96a600379494637fecb3b5cf13',
  'fleet-secrets.ts': '8c2337ea138a5185fac7244829220360000bd6df12d53ddc1f7502be97505e4a',
  'mail-slug-pattern.ts': 'f64fdfdcc164bae1a58656e8335042a9620c85d802e5bc8c7018fbfe5e2fb310',
  'secret-ref.ts': '4f4cba2a5fdc4d3d690bd655367fab31a5fb5daad4a5791931edaa674fa1b902',
  'workspace-secret-resolution.ts':
    'd02b7e7033437226506c107b28937378ca9bcc84f37ec2738ccc2066d25c74c0',
}

function digest(file: string): string {
  return createHash('sha256')
    .update(readFileSync(join(VENDOR_DIR, file)))
    .digest('hex')
}

describe('vendored contract files', () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} matches its reviewed digest`, () => {
      expect(digest(file)).toBe(expected)
    })
  }
})
