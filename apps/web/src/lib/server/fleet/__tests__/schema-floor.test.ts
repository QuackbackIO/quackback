/**
 * The `MIN_SCHEMA_VERSION` gate, both directions.
 *
 * The two directions are not symmetric and the second is the one that is easy
 * to get wrong: refusing a tenant that is *behind* is obviously required, but
 * **serving a tenant that is ahead** is what makes a rollout possible at all —
 * during one, the new image migrates a tenant that not-yet-restarted replicas
 * are still serving.
 *
 * Everything here uses the real bundled journal rather than a fixture, because
 * a fixture journal would let the prefix logic be right about a set of
 * migrations that does not exist.
 */
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_MIGRATIONS,
  evaluateSchemaFloor,
  latestBundledVersion,
  resolveVersionSpec,
  tagForVersion,
  UnknownSchemaVersion,
  type AppliedLedger,
} from '@quackback/db/schema-version'
import {
  __resetSchemaFloorMemo,
  configuredSchemaFloor,
  TenantSchemaFloorRefusal,
} from '../schema-floor'

function ledger(versions: number[]): AppliedLedger {
  return {
    versions: new Set(versions),
    count: versions.length,
    max: versions.length === 0 ? 0 : Math.max(...versions),
  }
}

const allWhens = BUNDLED_MIGRATIONS.map((e) => e.when)
const floor = resolveVersionSpec('0248')

describe('evaluateSchemaFloor', () => {
  it('accepts a database carrying every migration up to the floor', () => {
    const upToFloor = allWhens.filter((w) => w <= floor)
    const verdict = evaluateSchemaFloor(ledger(upToFloor), floor)
    expect(verdict.ok).toBe(true)
    expect(verdict.missing).toEqual([])
  })

  it('accepts a database AHEAD of the code — the rollout direction', () => {
    // Every bundled migration, plus two the build has never heard of. This is
    // exactly what a tenant migrated by the next image looks like to this one.
    const ahead = [...allWhens, latestBundledVersion() + 1000, latestBundledVersion() + 2000]
    const verdict = evaluateSchemaFloor(ledger(ahead), floor)
    expect(verdict.ok).toBe(true)
  })

  it('refuses a database missing a migration below the floor', () => {
    const upToFloor = allWhens.filter((w) => w <= floor)
    const withHole = upToFloor.filter((w) => w !== floor)
    const verdict = evaluateSchemaFloor(ledger(withHole), floor)
    expect(verdict.ok).toBe(false)
    expect(verdict.missing).toEqual([tagForVersion(floor)])
  })

  it('refuses a GAP below the floor even when the high-water mark clears it', () => {
    // The defect a `max(created_at) >= floor` check has, and the state five live
    // gauntlet databases were actually in: a ledger whose newest row is above
    // the floor while an older one is missing.
    const upToFloor = allWhens.filter((w) => w <= floor)
    const gapped = upToFloor.filter((w) => w !== upToFloor[upToFloor.length - 3])
    const l = ledger(gapped)
    expect(l.max).toBeGreaterThanOrEqual(floor)
    expect(evaluateSchemaFloor(l, floor).ok).toBe(false)
  })

  it('refuses an empty ledger', () => {
    expect(evaluateSchemaFloor(ledger([]), floor).ok).toBe(false)
  })
})

describe('resolveVersionSpec', () => {
  it('accepts a full tag, its numeric prefix, and the raw millis', () => {
    const entry = BUNDLED_MIGRATIONS.find((e) => e.tag.startsWith('0248_'))!
    expect(resolveVersionSpec(entry.tag)).toBe(entry.when)
    expect(resolveVersionSpec('0248')).toBe(entry.when)
    expect(resolveVersionSpec(String(entry.when))).toBe(entry.when)
  })

  it('throws on anything it cannot resolve, rather than degrading to no floor', () => {
    for (const bad of ['9999', 'nope', '0248_wrong_name', '1', '']) {
      expect(() => resolveVersionSpec(bad)).toThrow(UnknownSchemaVersion)
    }
  })
})

describe('configuredSchemaFloor', () => {
  it('is off when MIN_SCHEMA_VERSION is unset or blank', () => {
    __resetSchemaFloorMemo()
    expect(configuredSchemaFloor({} as NodeJS.ProcessEnv)).toBeNull()
    __resetSchemaFloorMemo()
    expect(configuredSchemaFloor({ MIN_SCHEMA_VERSION: '  ' } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('throws on a typo rather than silently disabling the gate', () => {
    __resetSchemaFloorMemo()
    expect(() =>
      configuredSchemaFloor({ MIN_SCHEMA_VERSION: '0248-typo' } as NodeJS.ProcessEnv)
    ).toThrow(UnknownSchemaVersion)
  })
})

describe('TenantSchemaFloorRefusal', () => {
  it('carries a code distinct from a fingerprint refusal, and names what is missing', () => {
    const err = new TenantSchemaFloorRefusal('inst_x', {
      ok: false,
      missing: ['0251_settings_cloud_tenant_id'],
      floorTag: '0251_settings_cloud_tenant_id',
    })
    expect(err.code).toBe('schema_below_floor')
    expect(err.message).toContain('0251_settings_cloud_tenant_id')
    // A fingerprint refusal means "wrong database" and is a security event; this
    // means "right database, mid-rollout". The strings must not be confusable.
    expect(err.message).not.toContain('workspace_id_mismatch')
  })
})
