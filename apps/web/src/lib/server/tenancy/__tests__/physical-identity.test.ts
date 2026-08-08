/**
 * The branch check — the only half of the fingerprint a copy-on-write clone
 * cannot satisfy.
 *
 * Every case here is written so that deleting the corresponding comparison in
 * `evaluatePhysicalIdentity` turns it red. That is not a formality: the whole
 * reason this predicate exists is that the *other* two fingerprint halves stay
 * green on a branch, so a test that could pass without the comparison would
 * reproduce exactly the blindness it was written to close.
 */
import { describe, expect, it } from 'vitest'
import { evaluatePhysicalIdentity } from '../physical-identity'

const REAL = {
  neonProjectId: 'tiny-credit-36813255',
  neonBranchId: 'br-weathered-lake-aupi87in',
}

const OBSERVED_REAL = {
  neonProjectId: 'tiny-credit-36813255',
  neonBranchId: 'br-weathered-lake-aupi87in',
  neonEndpointId: 'ep-tiny-poetry-auqd4saj',
}

describe('evaluatePhysicalIdentity', () => {
  it('accepts the compute the registry named', () => {
    expect(evaluatePhysicalIdentity(REAL, OBSERVED_REAL)).toEqual({ ok: true })
  })

  it('refuses a BRANCH of the tenant database', () => {
    // A Neon branch is a copy-on-write clone: `settings.id` and the control
    // plane's stamp are byte-identical to the parent's, so both content halves
    // of the fingerprint pass. Only the branch id differs.
    const verdict = evaluatePhysicalIdentity(REAL, {
      ...OBSERVED_REAL,
      neonBranchId: 'br-restore-of-the-real-thing',
      neonEndpointId: 'ep-some-other-endpoint',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'neon_branch_mismatch' })
    expect((verdict as { detail: string }).detail).toContain('br-restore-of-the-real-thing')
  })

  it('refuses another project entirely', () => {
    const verdict = evaluatePhysicalIdentity(REAL, {
      ...OBSERVED_REAL,
      neonProjectId: 'withered-paper-68223777',
      neonBranchId: 'br-blue-unit-awbih7mt',
    })
    expect(verdict).toMatchObject({ ok: false, code: 'neon_project_mismatch' })
  })

  it('refuses a database that cannot name itself when the registry says Neon', () => {
    // A proxy, a tunnel, or a restore into ordinary Postgres all look like
    // this. Failing open here would hand back the one case the check exists for.
    const verdict = evaluatePhysicalIdentity(REAL, {
      neonProjectId: null,
      neonBranchId: null,
      neonEndpointId: null,
    })
    expect(verdict).toMatchObject({ ok: false, code: 'neon_identity_unavailable' })
  })

  it('skips the check for a tenant the registry does not place on Neon', () => {
    // A self-hosted tenant has no branch to compare. Inventing a comparison
    // would only produce false refusals.
    expect(
      evaluatePhysicalIdentity(
        { neonProjectId: null, neonBranchId: null },
        { neonProjectId: null, neonBranchId: null, neonEndpointId: null }
      )
    ).toEqual({ ok: true })
  })

  it('still refuses when only the branch is declared', () => {
    // The project half alone is not enough: every branch of a project shares
    // its project id, so a check that only compared projects would pass the
    // branch case.
    expect(
      evaluatePhysicalIdentity(
        { neonProjectId: null, neonBranchId: 'br-weathered-lake-aupi87in' },
        { ...OBSERVED_REAL, neonBranchId: 'br-a-clone' }
      )
    ).toMatchObject({ ok: false, code: 'neon_branch_mismatch' })
  })

  it('still refuses when only the project is declared', () => {
    expect(
      evaluatePhysicalIdentity(
        { neonProjectId: 'tiny-credit-36813255', neonBranchId: null },
        { ...OBSERVED_REAL, neonProjectId: 'somewhere-else' }
      )
    ).toMatchObject({ ok: false, code: 'neon_project_mismatch' })
  })
})
