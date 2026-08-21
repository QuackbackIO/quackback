/**
 * The combined identity verdict, and the stamp-source rules around it.
 *
 * `evaluateFingerprint` itself is vendored from the control plane and tested
 * there; what is tested here is what this repo adds — reading the stamp from
 * the dedicated column in preference to the JSON bag, refusing when the two
 * disagree, and running the physical-identity check after the content one.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateWorkspaceIdentity,
  parseStamp,
  type WorkspaceIdentityObservation,
} from '../fingerprint'

const EXPECTED = {
  expectedWorkspaceKey: 'inst_cloud_ws_t1',
  expectedSelfReportedWorkspaceId: '019fe1ca-596e-7ff7-9edf-feecc2ce41b8',
  stampedAt: '2026-08-08T14:32:43.928Z',
}

const PHYSICAL = {
  catalogName: 'qb_ws_t1',
  catalogOid: '4242',
}

function observation(
  over: Partial<WorkspaceIdentityObservation> = {}
): WorkspaceIdentityObservation {
  return {
    selfReportedWorkspaceId: EXPECTED.expectedSelfReportedWorkspaceId,
    stamp: { v: 1, workspaceKey: EXPECTED.expectedWorkspaceKey, stampedAt: EXPECTED.stampedAt },
    settingsRowCount: 1,
    physical: {
      currentDatabase: PHYSICAL.catalogName,
      catalogOid: PHYSICAL.catalogOid,
    },
    stampSource: 'column',
    stampSourceConflict: null,
    secretCanary: null,
    storedCiphertext: { kind: 'unobserved' },
    ...over,
  }
}

describe('evaluateWorkspaceIdentity', () => {
  it('accepts a database that is who the registry says it is', () => {
    expect(evaluateWorkspaceIdentity(EXPECTED, PHYSICAL, observation())).toEqual({ ok: true })
  })

  it('refuses another workspace’s database — the §3 mix-up', () => {
    const verdict = evaluateWorkspaceIdentity(
      EXPECTED,
      PHYSICAL,
      observation({ selfReportedWorkspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0' })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'self_reported_workspace_id_mismatch' })
  })

  it('refuses an unstamped database rather than falling back to the workspace id', () => {
    // A database the control plane has not claimed is not a database this fleet
    // may serve. Two facts, both required.
    expect(
      evaluateWorkspaceIdentity(
        EXPECTED,
        PHYSICAL,
        observation({ stamp: null, stampSource: 'none' })
      )
    ).toMatchObject({ ok: false, code: 'stamp_missing' })
  })

  it('refuses a database with no settings row', () => {
    expect(
      evaluateWorkspaceIdentity(
        EXPECTED,
        PHYSICAL,
        observation({ settingsRowCount: 0, selfReportedWorkspaceId: null, stamp: null })
      )
    ).toMatchObject({ ok: false, code: 'settings_row_missing' })
  })

  it('refuses a database with more than one settings row', () => {
    // `settings` being a singleton is what makes the database the workspace
    // boundary in the first place.
    expect(
      evaluateWorkspaceIdentity(
        EXPECTED,
        PHYSICAL,
        observation({ settingsRowCount: 2, selfReportedWorkspaceId: null, stamp: null })
      )
    ).toMatchObject({ ok: false, code: 'settings_not_singleton' })
  })

  it('refuses when the column and the metadata bag name different workspaces', () => {
    const verdict = evaluateWorkspaceIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        stampSourceConflict: {
          column: 'inst_cloud_ws_t1',
          metadata: 'inst_cloud_ws_t2',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'stamp_source_conflict' })
  })

  it('refuses a clone even though every content fact matches', () => {
    // The observation here is byte-identical to a healthy one except for the
    // catalog oid — which is precisely the shape a dump/restore produces.
    const verdict = evaluateWorkspaceIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        physical: {
          currentDatabase: PHYSICAL.catalogName,
          catalogOid: '9999',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'catalog_oid_mismatch' })
  })

  it('reports a content mix-up as a content problem, not a placement one', () => {
    // Ordering matters for the operator: a wrong-database mix-up must not
    // surface as "catalog oid mismatch" just because both are wrong at once.
    const verdict = evaluateWorkspaceIdentity(
      EXPECTED,
      PHYSICAL,
      observation({
        selfReportedWorkspaceId: '019fe1d3-b692-7eeb-ab34-9a1d81f5b4f0',
        physical: {
          currentDatabase: 'qb_other',
          catalogOid: '8888',
        },
      })
    )
    expect(verdict).toMatchObject({ ok: false, code: 'self_reported_workspace_id_mismatch' })
  })
})

describe('parseStamp', () => {
  it('reads a well-formed stamp out of the metadata bag', () => {
    expect(
      parseStamp(
        JSON.stringify({
          instanceId: 'unrelated',
          cloudTenant: { v: 1, workspaceKey: 'inst_x', stampedAt: '2026-01-01T00:00:00.000Z' },
        })
      )
    ).toEqual({ v: 1, workspaceKey: 'inst_x', stampedAt: '2026-01-01T00:00:00.000Z' })
  })

  it.each([
    ['null metadata', null],
    ['empty string', ''],
    ['not JSON', 'not json at all'],
    ['a JSON array', '[]'],
    ['a bag with no stamp', '{"instanceId":"x"}'],
    ['a stamp of the wrong version', '{"cloudTenant":{"v":2,"workspaceKey":"x","stampedAt":"y"}}'],
    ['a stamp with no workspace', '{"cloudTenant":{"v":1,"stampedAt":"y"}}'],
  ])('returns null for %s rather than throwing', (_label, metadata) => {
    expect(parseStamp(metadata)).toBeNull()
  })
})
