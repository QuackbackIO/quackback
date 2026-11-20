/**
 * Tests for segmentConditionSchema / createSegmentSchema.
 *
 * The server-side Zod validator that guards createSegmentFn and
 * updateSegmentFn must accept all valid SegmentRuleAttribute values —
 * including the three built-in fields added in the access-controls feature.
 *
 * These tests exercise the schemas directly (no DB or auth required) to
 * lock down the attribute allowlist at the validation layer.
 */
import { describe, it, expect, vi } from 'vitest'

// segmentConditionSchema and createSegmentSchema are exported from admin.ts.
// admin.ts registers server functions on import — mock the two deps that
// execute side-effectful registration code.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler() {
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@/lib/server/domains/notifications/notification.service', () => ({}))

import { segmentConditionSchema, createSegmentSchema } from '../admin'

// ---------------------------------------------------------------------------
// segmentConditionSchema
// ---------------------------------------------------------------------------

describe('segmentConditionSchema — attribute allowlist', () => {
  const baseCondition = { operator: 'eq' as const, value: 'test' }

  it.each([
    'email',
    'email_verified',
    'created_at_days_ago',
    'post_count',
    'vote_count',
    'comment_count',
    'metadata_key',
    'name',
    'locale',
    'country',
    'last_active_days_ago',
    'signup_source',
    'principal_type',
  ])('accepts attribute "%s"', (attribute) => {
    const result = segmentConditionSchema.safeParse({ attribute, ...baseCondition })
    expect(result.success, `expected success for attribute "${attribute}"`).toBe(true)
  })

  it('rejects an unknown attribute', () => {
    const result = segmentConditionSchema.safeParse({ attribute: 'plan', ...baseCondition })
    expect(result.success).toBe(false)
  })

  it('rejects a completely bogus attribute', () => {
    const result = segmentConditionSchema.safeParse({ attribute: 'not_real', ...baseCondition })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createSegmentSchema — full payload round-trip with new attributes
// ---------------------------------------------------------------------------

describe('createSegmentSchema — new built-in field conditions', () => {
  const makePayload = (attribute: string) => ({
    name: 'Test segment',
    type: 'dynamic' as const,
    rules: {
      match: 'all' as const,
      conditions: [{ attribute, operator: 'eq', value: 'alice' }],
    },
  })

  it('accepts a segment with a "name" condition', () => {
    const result = createSegmentSchema.safeParse(makePayload('name'))
    expect(result.success).toBe(true)
  })

  it('rejects a segment with a "display_name" condition (dropped attribute)', () => {
    const result = createSegmentSchema.safeParse(makePayload('display_name'))
    expect(result.success).toBe(false)
  })

  it('accepts a segment with a "principal_type" condition', () => {
    const result = createSegmentSchema.safeParse(makePayload('principal_type'))
    expect(result.success).toBe(true)
  })

  it('accepts a segment with a "locale" condition', () => {
    const result = createSegmentSchema.safeParse(makePayload('locale'))
    expect(result.success).toBe(true)
  })

  it('rejects a segment whose condition uses a removed attribute ("plan")', () => {
    const result = createSegmentSchema.safeParse(makePayload('plan'))
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// evaluationSchedule: only patterns the scheduler can run
// ---------------------------------------------------------------------------

describe('createSegmentSchema — evaluation schedule', () => {
  const withPattern = (pattern: string) => ({
    name: 'Scheduled',
    type: 'dynamic' as const,
    rules: {
      match: 'all' as const,
      conditions: [{ attribute: 'email', operator: 'eq', value: 'a' }],
    },
    evaluationSchedule: { enabled: true, pattern },
  })

  it.each(['0 * * * *', '*/15 9-17 * * 1-5', '0 0 1,15 * *'])('accepts %s', (pattern) => {
    expect(createSegmentSchema.safeParse(withPattern(pattern)).success).toBe(true)
  })

  it.each(['99 99 * * *', '0 0 32 * *', '0 0 * 13 *', '0 0 * * * *', 'every hour'])(
    'refuses %s, which the scheduler cannot parse',
    (pattern) => {
      const result = createSegmentSchema.safeParse(withPattern(pattern))
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('Must be a valid cron expression')
    }
  )
})
