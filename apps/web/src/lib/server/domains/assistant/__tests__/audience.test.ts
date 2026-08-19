import { describe, it, expect } from 'vitest'
import {
  resolveContentAudience,
  toHelpCenterAudience,
  canSee,
  CONTENT_AUDIENCE_RANK,
  type ContentAudience,
} from '../audience'
import { ASSISTANT_SURFACES, type AssistantSurface } from '@/lib/shared/assistant/surfaces'

describe('resolveContentAudience', () => {
  it('resolves the customer-facing surfaces to public', () => {
    expect(resolveContentAudience('widget')).toBe('public')
    expect(resolveContentAudience('email')).toBe('public')
    expect(resolveContentAudience('workflow_step')).toBe('public')
  })

  it('resolves the teammate-facing surface to team', () => {
    expect(resolveContentAudience('copilot')).toBe('team')
  })

  it('never resolves a customer-facing surface above public', () => {
    const customerFacing: AssistantSurface[] = ['widget', 'email', 'workflow_step']
    for (const surface of customerFacing) {
      expect(resolveContentAudience(surface)).toBe('public')
    }
  })

  // Exhaustiveness guard: every declared surface must resolve without
  // throwing. If a new surface is added to ASSISTANT_SURFACES without
  // extending resolveContentAudience's switch, `tsc` already fails the build
  // (the `never` assignment in the default branch); this test additionally
  // catches the case where the switch was extended sloppily (e.g. a case
  // that falls through to the default throw at runtime).
  it('handles every declared assistant surface', () => {
    for (const surface of ASSISTANT_SURFACES) {
      expect(() => resolveContentAudience(surface)).not.toThrow()
    }
  })

  it('throws for a surface outside the allow-list (defense in depth against a bad cast)', () => {
    const bogus = 'not_a_real_surface' as unknown as AssistantSurface
    expect(() => resolveContentAudience(bogus)).toThrow()
  })
})

describe('CONTENT_AUDIENCE_RANK / canSee', () => {
  it('ranks public < team < internal (higher is stricter)', () => {
    expect(CONTENT_AUDIENCE_RANK.public).toBeLessThan(CONTENT_AUDIENCE_RANK.team)
    expect(CONTENT_AUDIENCE_RANK.team).toBeLessThan(CONTENT_AUDIENCE_RANK.internal)
  })

  it('a public ceiling only sees public rows', () => {
    expect(canSee('public', 'public')).toBe(true)
    expect(canSee('public', 'team')).toBe(false)
    expect(canSee('public', 'internal')).toBe(false)
  })

  it('a team ceiling sees public and team rows, not internal', () => {
    expect(canSee('team', 'public')).toBe(true)
    expect(canSee('team', 'team')).toBe(true)
    expect(canSee('team', 'internal')).toBe(false)
  })

  it('an internal ceiling sees everything', () => {
    const rows: ContentAudience[] = ['public', 'team', 'internal']
    for (const row of rows) {
      expect(canSee('internal', row)).toBe(true)
    }
  })
})

describe('toHelpCenterAudience', () => {
  it('maps public to public', () => {
    expect(toHelpCenterAudience('public')).toBe('public')
  })

  it('maps team to team', () => {
    expect(toHelpCenterAudience('team')).toBe('team')
  })

  it('collapses internal to team (KB has no internal-only tier today)', () => {
    expect(toHelpCenterAudience('internal')).toBe('team')
  })
})
