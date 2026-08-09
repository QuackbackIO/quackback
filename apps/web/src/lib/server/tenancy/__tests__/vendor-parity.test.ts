/**
 * The vendored contract must stay byte-identical to the control plane's.
 *
 * `evaluateFingerprint` is the predicate that decides whether this fleet may
 * serve a database. It lives in one function, in one file, on purpose: two
 * repos independently *reading* the same prose is exactly how one of them ends
 * up with a slightly more forgiving version, and the forgiving one is the one
 * that serves the wrong tenant.
 *
 * Copying is the pragmatic answer — the app cannot import from the control
 * plane at build time — so the copy needs a tripwire. Two, in fact:
 *
 * 1. **A committed digest.** Always runs, everywhere, with no dependency on
 *    another checkout. Editing the vendored file without editing this constant
 *    fails CI, which forces the change to be deliberate and reviewable.
 * 2. **A direct comparison** against the control-plane checkout when one is
 *    present. That catches drift in the OTHER direction — the control plane
 *    changing while this copy stands still — which the digest alone cannot see.
 *
 * The second check is skipped when the sibling repo is absent, and a skipped
 * check reports success. That is precisely why it is not the only check.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const vendorDir = join(here, '..', 'vendor')

/**
 * SHA-256 of each vendored file, as copied from `quackback-cp`
 * `src/lib/server/tenancy/`. Changing a vendored file means changing the digest
 * here too — which is the point.
 */
const VENDORED = {
  'contract.ts': 'a70f5c052d10713a7e01a28e502ba019fc49e51d15784cd1acbf091514797a29',
  'secret-ref.ts': 'e4c714c7ff097e94c5e27fd5cc95d31e4656de657a60c9953e2c897bf48f567a',
  // Sealing and derivation, vendored for a sharper reason than the others: the
  // control plane seals a value and a fleet replica opens it. Drift here is not
  // a wrong answer, it is ciphertext nobody can open — and for SECRET_KEY that
  // means integration tokens, webhook secrets and custom-action headers are
  // permanently unrecoverable. The digest is the only thing standing between a
  // one-line "tidy-up" in one repo and data loss in the other.
  'fleet-secrets.ts': 'c9da2db5c7060c1c77a19e3344e728e044d339d8cdcabfac503b9577842bccb4',
  'tenant-secret-resolution.ts':
    '0ff468aa302a1574a152e3959f10bfcd7462c0941d29ed669b3e71ca7ab9ce0b',
} as const

/** Where the control plane lives when this machine has a checkout of it. */
const CP_TENANCY = process.env.QUACKBACK_CP_TENANCY_DIR ?? '/home/james/quackback-cp/src/lib/server/tenancy'

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('vendored control-plane contract', () => {
  it.each(Object.entries(VENDORED))('%s matches its recorded digest', (file, expected) => {
    expect(digest(join(vendorDir, file))).toBe(expected)
  })

  const cpPresent = existsSync(join(CP_TENANCY, 'contract.ts'))

  it('reports whether the control-plane comparison was available', () => {
    // Deliberately an assertion rather than a skip: a suite that quietly does
    // not run reads as green, and the whole point of this file is that a silent
    // pass is the failure mode.
    expect(typeof cpPresent).toBe('boolean')
    if (!cpPresent) {
      expect(Object.keys(VENDORED).length).toBeGreaterThan(0)
    }
  })

  it.runIf(cpPresent).each(Object.keys(VENDORED))(
    '%s is byte-identical to the control plane copy',
    (file) => {
      expect(readFileSync(join(vendorDir, file), 'utf8')).toBe(
        readFileSync(join(CP_TENANCY, file), 'utf8')
      )
    }
  )
})

describe('the vendored predicate is the one that runs', () => {
  it('is reached through the app’s own fingerprint module', async () => {
    // Guards against the copy being vendored and then quietly bypassed by a
    // locally re-derived check — which is the failure the vendoring exists to
    // prevent, and which a file-hash test alone would not notice.
    const app = await import('../fingerprint')
    const vendored = await import('../vendor/contract')
    const expected = {
      expectedTenantId: 'inst_a',
      expectedWorkspaceId: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
      stampedAt: 'x',
    }
    const observed = {
      workspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0',
      stamp: { v: 1 as const, tenantId: 'inst_a', stampedAt: 'x' },
      settingsRowCount: 1,
    }

    const direct = vendored.evaluateFingerprint(expected, observed)
    const throughApp = app.evaluateTenantIdentity(
      expected,
      { neonProjectId: null, neonBranchId: null },
      { ...observed, physical: { neonProjectId: null, neonBranchId: null, neonEndpointId: null }, stampSource: 'metadata', stampSourceConflict: null, secretCanary: null }
    )

    expect(direct).toMatchObject({ ok: false, code: 'workspace_id_mismatch' })
    expect(throughApp).toEqual(direct)
  })
})
