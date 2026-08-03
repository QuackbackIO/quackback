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
      inputValidator() {
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
    'contact_title',
    'contact_metadata_key',
    'organization_domain',
    'organization_external_id',
    'organization_metadata_key',
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

  it('accepts a segment with an "organization_domain" condition', () => {
    const result = createSegmentSchema.safeParse(makePayload('organization_domain'))
    expect(result.success).toBe(true)
  })

  it('rejects a segment whose condition uses a removed attribute ("plan")', () => {
    const result = createSegmentSchema.safeParse(makePayload('plan'))
    expect(result.success).toBe(false)
  })
})
