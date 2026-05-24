/**
 * audienceSchema — Zod validation for the per-board audience payload.
 *
 * The schema is the LAST line of defense against a board being
 * accidentally restricted to nobody. The `segments` branch must reject
 * an empty `segmentIds` array because:
 *
 *   - canViewBoard's `.some(...)` over an empty allowlist returns false,
 *     so the board becomes invisible to every non-team viewer.
 *   - boardViewFilter collapses the segments branch to `false` for
 *     matching when memberIds is empty (same outcome via SQL).
 *
 * The client form disables Save in this state, but the schema is the
 * defense-in-depth — REST/MCP/imports + future call sites cannot rely
 * on the client gate.
 */
import { describe, it, expect } from 'vitest'
import { audienceSchema } from '../boards'

describe('audienceSchema', () => {
  describe('public', () => {
    it('accepts { kind: "public" }', () => {
      expect(audienceSchema.parse({ kind: 'public' })).toEqual({ kind: 'public' })
    })
  })

  describe('authenticated', () => {
    it('accepts { kind: "authenticated" }', () => {
      expect(audienceSchema.parse({ kind: 'authenticated' })).toEqual({ kind: 'authenticated' })
    })
  })

  describe('team', () => {
    it('accepts { kind: "team" }', () => {
      expect(audienceSchema.parse({ kind: 'team' })).toEqual({ kind: 'team' })
    })
  })

  describe('segments', () => {
    it('accepts { kind: "segments", segmentIds: ["seg_1"] }', () => {
      expect(audienceSchema.parse({ kind: 'segments', segmentIds: ['seg_1'] })).toEqual({
        kind: 'segments',
        segmentIds: ['seg_1'],
      })
    })

    it('accepts up to 50 segment ids', () => {
      const segmentIds = Array.from({ length: 50 }, (_, i) => `seg_${i}`)
      expect(audienceSchema.parse({ kind: 'segments', segmentIds })).toEqual({
        kind: 'segments',
        segmentIds,
      })
    })

    it('REJECTS more than 50 segment ids', () => {
      const segmentIds = Array.from({ length: 51 }, (_, i) => `seg_${i}`)
      expect(() => audienceSchema.parse({ kind: 'segments', segmentIds })).toThrow()
    })

    // ---- The lockout-prevention guard ----
    it('REJECTS { kind: "segments", segmentIds: [] } — an empty allowlist hides the board from everyone', () => {
      expect(() => audienceSchema.parse({ kind: 'segments', segmentIds: [] })).toThrow()
    })

    it('REJECTS missing segmentIds field on a segments audience', () => {
      expect(() => audienceSchema.parse({ kind: 'segments' })).toThrow()
    })
  })

  describe('rejected shapes', () => {
    it('rejects an unknown kind', () => {
      expect(() => audienceSchema.parse({ kind: 'invite-only' })).toThrow()
    })

    it('rejects missing kind', () => {
      expect(() => audienceSchema.parse({})).toThrow()
    })
  })
})
