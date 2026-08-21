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
 * control-plane counterpart carries the same semantic change. (Byte-for-byte
 * parity across the two repos is not asserted yet: the CP copies have moved to
 * the workspace vocabulary while this side still says tenant. Until that
 * rename lands here, parity is semantic and this snapshot is the tripwire.)
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const VENDOR_DIR = join(import.meta.dirname, '..', 'vendor')

const EXPECTED: Record<string, string> = {
  'contract.ts': '06aa858b451633839911a17033c89558aef318404235efd31f0432a1cf3b3372',
  'fleet-secrets.ts': '9006bd299ca07e3a0300d1cd18c7f8bb587dbafcbeb72e6b5a0fe5ce75641d2b',
  'secret-ref.ts': '6092e5cabd1ea5a65ce4f5e559ccaa04837a4aa8221885c449d7e3ca7afdc47c',
  'tenant-secret-resolution.ts': '363512010d22662d1f96d11b44437f5df0f952a29758f6864684d6c38fdf7d95',
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
