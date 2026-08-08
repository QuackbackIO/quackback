/**
 * The combined identity verdict, and the stamp-source rules around it.
 *
 * `evaluateFingerprint` itself is vendored from the control plane and tested
 * there; what is tested here is what this repo adds — reading the stamp from
 * the dedicated column in preference to the JSON bag, refusing when the two
 * disagree, and running the physical-identity check after the content one.
 */
import { describe, expect, it } from 'vitest'
import { evaluateTenantIdentity, parseStamp, type TenantIdentityObservation } from '../fingerprint'

const EXPECTED = {
  expectedTenantId: 'inst_gauntlet_neon_t1',
  expectedWorkspaceId: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
  stampedAt: '2026-08-08T14:32:43.928Z',
}

const PHYSICAL = {
  neonProjectId: 'tiny-credit-36813255',
  neonBranchId: 'br-weathered-lake-aupi87in',
}

function observation(over: Partial<TenantIdentityObservation> = {}): TenantIdentityObservation {
  return {
    workspaceId: EXPECTED.expectedWorkspaceId,
    stamp: { v: 1, tenantId: EXPECTED.expectedTenantId, stampedAt: EXPECTED.stampedAt },
    settingsRowCount: 1,
    physical: {
      neonProjectId: PHYSICAL.neonProjectId,
      neonBranchId: PHYSICAL.neonBranchId,
      neonEndpointId: 'ep-tiny-poetry-auqd4saj',
    },
    stampSource: 'column',
    stampSourceConflict: null,
    ...over,
  }
}

describe('evaluateTenantIdentity', () => {
  it('accepts a database that is who the registry says it is', () => {
    expect(evaluateTenantIdentity(EXPECTED, PHYSICAL, observation())).toEqual({ ok: true })
  })

  it('refuses another tenant’s database — the §3 mix-up', () => {
    const verdict = evaluateTenantIdentity(
      EXPECTED,
      PHYSICAL,
      observation({ workspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0' })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'workspace_id_mismatch' })
  })

  it('refuses an unstamped database rather than falling back to the workspace id', () => {
    // A database the control plane has not claimed is not a database this fleet
    // may serve. Two facts, both required.
    expect(
      evaluateTenantIdentity(EXPECTED, PHYSICAL, observation({ stamp: null, stampSource: 'none' }))
    ).toMatchObject({ ok: false, code: 'stamp_missing' })
  })

  it('refuses a database with no settings row', () => {
    expect(
      evaluateTenantIdentity(
        EXPECTED,
        PHYSICAL,
        observation({ settingsRowCount: 0, workspaceId: null, stamp: null })
      )
    ).toMatchObject({ ok: false, code: 'settings_row_missing' })
  })

  it('refuses a database with more than one settings row', () => {
    // `settings` being a singleton is what makes the database the tenant
    // boundary in the first place.
    expect(
      evaluateTenantIdentity(
        EXPECTED,
        PHYSICAL,
        observation({ settingsRowCount: 2, workspaceId: null, stamp: null })
      )
    ).toMatchObject({ ok: false, code: 'settings_not_singleton' })
  })

  it('refuses when the column and the metadata bag name different tenants', () => {
    const verdict = evaluateTenantIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        stampSourceConflict: {
          column: 'inst_gauntlet_neon_t1',
          metadata: 'inst_gauntlet_neon_t2',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'stamp_source_conflict' })
  })

  it('refuses a branch even though every content fact matches', () => {
    // The observation here is byte-identical to a healthy one except for the
    // branch id — which is precisely the shape a Neon clone produces.
    const verdict = evaluateTenantIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        physical: {
          neonProjectId: PHYSICAL.neonProjectId,
          neonBranchId: 'br-a-restore-of-t1',
          neonEndpointId: 'ep-elsewhere',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'neon_branch_mismatch' })
  })

  it('reports a content mix-up as a content problem, not a placement one', () => {
    // Ordering matters for the operator: a wrong-database mix-up must not
    // surface as "branch mismatch" just because both are wrong at once.
    const verdict = evaluateTenantIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        workspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0',
        physical: {
          neonProjectId: 'withered-paper-68223777',
          neonBranchId: 'br-blue-unit-awbih7mt',
          neonEndpointId: 'ep-round-mud-aw950r34',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'workspace_id_mismatch' })
  })
})

describe('parseStamp', () => {
  it('reads a well-formed stamp out of the metadata bag', () => {
    expect(
      parseStamp(
        JSON.stringify({
          instanceId: 'unrelated',
          cloudTenant: { v: 1, tenantId: 'inst_x', stampedAt: '2026-01-01T00:00:00.000Z' },
        })
      )
    ).toEqual({ v: 1, tenantId: 'inst_x', stampedAt: '2026-01-01T00:00:00.000Z' })
  })

  it.each([
    ['null metadata', null],
    ['empty string', ''],
    ['not JSON', 'not json at all'],
    ['a JSON array', '[]'],
    ['a bag with no stamp', '{"instanceId":"x"}'],
    ['a stamp of the wrong version', '{"cloudTenant":{"v":2,"tenantId":"x","stampedAt":"y"}}'],
    ['a stamp with no tenant', '{"cloudTenant":{"v":1,"stampedAt":"y"}}'],
  ])('returns null for %s rather than throwing', (_label, metadata) => {
    expect(parseStamp(metadata)).toBeNull()
  })
})
