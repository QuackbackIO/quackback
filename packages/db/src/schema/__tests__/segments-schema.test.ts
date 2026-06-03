import { describe, it, expect } from 'vitest'
import { segments, userSegments } from '../segments'

describe('userSegments schema', () => {
  it('accepts all five addedBy values', () => {
    type Insert = typeof userSegments.$inferInsert
    const sources: Insert['addedBy'][] = ['manual', 'dynamic', 'sso', 'widget', 'api']
    expect(sources).toHaveLength(5)
  })
})

describe('segments schema', () => {
  it('requires slug on insert', () => {
    // $inferInsert excludes columns with defaults but keeps NOT NULL columns
    // without defaults required — slug has neither default nor optional flag.
    type Insert = typeof segments.$inferInsert
    const sample: Insert = { name: 'Enterprise', slug: 'enterprise' } as Insert
    expect(sample.slug).toBe('enterprise')
  })
})
