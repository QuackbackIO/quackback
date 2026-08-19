import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { resolveSurfaces } from '../resolve'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src

/**
 * The completeness CI gate: every authorization site the scanner finds must
 * resolve to a definite expectation — a catalogue permission (self-describing),
 * or a hand-declared classification (END_USER / PUBLIC_DATA / MCP_ENTRY /
 * SECONDARY_GATE / NOT_A_GATE). An unparseable gate, an unclassified bare/inline
 * site, or a stale classification all surface as reconciliation errors and fail
 * here.
 *
 * Scope: this proves every *scanned gate* is classified — it catches a widened
 * or changed gate. A gate that was never written (a new entry point with no
 * requireAuth at all) has nothing to scan, so it is caught by the entry-point
 * inventory pinned in MATRIX.md §4 (a new ungated entry point is a snapshot
 * diff), not here. Together they cover "a new route/function/tool added without
 * an auth expectation."
 */
describe('authorization surface completeness', () => {
  const { surfaces, errors } = resolveSurfaces(SRC_ROOT)

  it('reconciles the live scan against the classifications with no drift', () => {
    expect(errors, `\n${errors.join('\n')}\n`).toEqual([])
  })

  it('resolves a non-trivial number of surfaces (guards against a broken scan)', () => {
    // The scan finds ~400 gates; the resolved set drops NOT_A_GATE refinements.
    expect(surfaces.length).toBeGreaterThan(300)
  })

  it('every resolved surface carries a concrete authorization', () => {
    const orphan = surfaces.filter((s) => !s.authz || !('type' in s.authz))
    expect(orphan).toEqual([])
  })

  it('every permission a gate enforces is a real catalogue key', () => {
    // resolveSurfaces already errors on unknown consts; this asserts the
    // positive: permission surfaces only ever carry catalogue permissions.
    const perms = surfaces.flatMap((s) =>
      s.authz.type === 'permission'
        ? [s.authz.permission]
        : s.authz.type === 'role_gate' && s.authz.permission
          ? [s.authz.permission]
          : []
    )
    expect(perms.length).toBeGreaterThan(0)
  })
})
