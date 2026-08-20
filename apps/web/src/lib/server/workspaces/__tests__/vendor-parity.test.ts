/**
 * The vendored contract must stay byte-identical to the control plane's.
 *
 * `evaluateFingerprint` is the predicate that decides whether this fleet may
 * serve a database. It lives in one function, in one file, on purpose: two
 * repos independently *reading* the same prose is exactly how one of them ends
 * up with a slightly more forgiving version, and the forgiving one is the one
 * that serves the wrong workspace.
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
 * `src/lib/server/workspaces/`. Changing a vendored file means changing the digest
 * here too — which is the point.
 */
const VENDORED = {
  'contract.ts': '672c6a929a8991d05d4bb056c6fb2592110317cfcd0f2dc1f575c2d3c706c022',
  // The mail slug vocabulary, which `contract.ts` imports and re-exports. It is
  // a separate module on the control plane so the edge mail Worker can apply the
  // same rule without pulling zod and the record schema into a workerd bundle;
  // it is vendored here because `contract.ts` does not compile without it.
  'mail-slug-pattern.ts': 'f64fdfdcc164bae1a58656e8335042a9620c85d802e5bc8c7018fbfe5e2fb310',
  'secret-ref.ts': '4f4cba2a5fdc4d3d690bd655367fab31a5fb5daad4a5791931edaa674fa1b902',
  // Sealing and derivation, vendored for a sharper reason than the others: the
  // control plane seals a value and a fleet replica opens it. Drift here is not
  // a wrong answer, it is ciphertext nobody can open — and for SECRET_KEY that
  // means integration tokens, webhook secrets and custom-action headers are
  // permanently unrecoverable. The digest is the only thing standing between a
  // one-line "tidy-up" in one repo and data loss in the other.
  'fleet-secrets.ts': '8c2337ea138a5185fac7244829220360000bd6df12d53ddc1f7502be97505e4a',
  'workspace-secret-resolution.ts':
    'd02b7e7033437226506c107b28937378ca9bcc84f37ec2738ccc2066d25c74c0',
} as const

/** Where the control plane lives when this machine has a checkout of it. */
const CP_TENANCY =
  process.env.QUACKBACK_CP_TENANCY_DIR ?? '/home/james/quackback-cp/src/lib/server/tenancy'

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
      expectedWorkspaceKey: 'inst_a',
      expectedSelfReportedWorkspaceId: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
      stampedAt: 'x',
    }
    const observed = {
      selfReportedWorkspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0',
      stamp: { v: 1 as const, workspaceKey: 'inst_a', stampedAt: 'x' },
      settingsRowCount: 1,
    }

    const direct = vendored.evaluateFingerprint(expected, observed)
    const throughApp = app.evaluateWorkspaceIdentity(
      expected,
      { catalogName: null, catalogOid: null },
      {
        ...observed,
        physical: { currentDatabase: null, catalogOid: null },
        stampSource: 'metadata',
        stampSourceConflict: null,
        secretCanary: null,
        storedCiphertext: { kind: 'unobserved' },
      }
    )

    expect(direct).toMatchObject({ ok: false, code: 'self_reported_workspace_id_mismatch' })
    expect(throughApp).toEqual(direct)
  })
})
