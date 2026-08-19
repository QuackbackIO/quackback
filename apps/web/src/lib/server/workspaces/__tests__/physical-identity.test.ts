/**
 * The catalog check — the only half of the fingerprint a dump/restore or
 * TEMPLATE clone cannot satisfy.
 *
 * Every case here is written so that deleting the corresponding comparison in
 * `evaluatePhysicalIdentity` turns it red. That is not a formality: the whole
 * reason this predicate exists is that the *other* two fingerprint halves stay
 * green on a clone, so a test that could pass without the comparison would
 * reproduce exactly the blindness it was written to close.
 */
import { describe, expect, it } from 'vitest'
import { evaluatePhysicalIdentity } from '../physical-identity'

const REAL = {
  catalogName: 'qb_acme',
  catalogOid: '4242',
  clusterId: 'fleet-a',
}

const OBSERVED_REAL = {
  currentDatabase: 'qb_acme',
  catalogOid: '4242',
}

describe('evaluatePhysicalIdentity', () => {
  it('accepts the catalog the registry named', () => {
    expect(evaluatePhysicalIdentity(REAL, OBSERVED_REAL)).toEqual({ ok: true })
  })

  it('refuses a dump/restore whose oid was not updated', () => {
    // A TEMPLATE clone or dump/restore is byte-identical on `settings.id` and
    // the control plane's stamp, so both content halves of the fingerprint
    // pass. Only the catalog oid differs.
    const verdict = evaluatePhysicalIdentity(REAL, {
      ...OBSERVED_REAL,
      catalogOid: '9999',
    })
    expect(verdict.ok).toBe(false)
    expect(verdict).toMatchObject({ code: 'catalog_oid_mismatch' })
    expect((verdict as { detail: string }).detail).toContain('9999')
  })

  it('refuses a connection to the wrong database name', () => {
    expect(
      evaluatePhysicalIdentity(REAL, {
        ...OBSERVED_REAL,
        currentDatabase: 'qb_other',
      })
    ).toMatchObject({ ok: false, code: 'catalog_name_mismatch' })
  })

  it('skips the check for a workspace the registry does not place on a catalog', () => {
    // A self-hosted workspace has no catalog oid to compare. Inventing a
    // comparison would only produce false refusals.
    expect(
      evaluatePhysicalIdentity(
        { catalogName: null, catalogOid: null, clusterId: null },
        { currentDatabase: null, catalogOid: null }
      )
    ).toEqual({ ok: true })
  })

  it('still refuses when only the oid is declared', () => {
    expect(
      evaluatePhysicalIdentity(
        { catalogName: null, catalogOid: '4242', clusterId: null },
        { ...OBSERVED_REAL, catalogOid: '9999' }
      )
    ).toMatchObject({ ok: false, code: 'catalog_oid_mismatch' })
  })

  it('still refuses when only the name is declared', () => {
    expect(
      evaluatePhysicalIdentity(
        { catalogName: 'qb_acme', catalogOid: null, clusterId: null },
        { ...OBSERVED_REAL, currentDatabase: 'qb_other' }
      )
    ).toMatchObject({ ok: false, code: 'catalog_name_mismatch' })
  })

  it('carries clusterId on the expectation without requiring it on the observation', () => {
    expect(
      evaluatePhysicalIdentity(
        { catalogName: 'qb_acme', catalogOid: '4242', clusterId: 'fleet-a' },
        OBSERVED_REAL
      )
    ).toEqual({ ok: true })
  })
})
