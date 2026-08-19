import { describe, it, expect } from 'vitest'
import { summariseAccountDuplicates } from '../account-duplicates'

describe('summariseAccountDuplicates', () => {
  it('reports nothing for a clean set', () => {
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 's1' },
      { userId: 'u2', providerId: 'oidc_a', accountId: 's2' },
    ])
    expect(result.clean).toBe(true)
    expect(result.duplicatePairs).toEqual([])
    expect(result.sharedIdentities).toEqual([])
  })

  it('flags a user with two accounts on the same provider', () => {
    // The fork shape: the account lookup missed, the email fallback found the
    // user, and a second row was written beside the first.
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 'old-subject' },
      { userId: 'u1', providerId: 'oidc_a', accountId: 'new-subject' },
    ])
    expect(result.clean).toBe(false)
    expect(result.duplicatePairs).toEqual([{ userId: 'u1', providerId: 'oidc_a', count: 2 }])
  })

  it('flags one identity claimed by two different users', () => {
    // Worse than a fork: two people resolve to the same upstream identity.
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 'shared' },
      { userId: 'u2', providerId: 'oidc_a', accountId: 'shared' },
    ])
    expect(result.clean).toBe(false)
    expect(result.sharedIdentities).toEqual([
      { providerId: 'oidc_a', accountId: 'shared', count: 2 },
    ])
  })

  it('does not confuse the same subject across different providers', () => {
    // Two IdPs can legitimately mint the same subject string.
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 'same' },
      { userId: 'u1', providerId: 'oidc_b', accountId: 'same' },
    ])
    expect(result.clean).toBe(true)
  })

  it('counts accurately beyond a pair', () => {
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 'a' },
      { userId: 'u1', providerId: 'oidc_a', accountId: 'b' },
      { userId: 'u1', providerId: 'oidc_a', accountId: 'c' },
    ])
    expect(result.duplicatePairs[0]).toEqual({ userId: 'u1', providerId: 'oidc_a', count: 3 })
  })

  it('never includes an account identifier in the redacted summary', () => {
    // The summary is logged. Subjects are upstream identifiers, so the counts
    // travel and the values do not.
    const result = summariseAccountDuplicates([
      { userId: 'u1', providerId: 'oidc_a', accountId: 'sensitive-subject' },
      { userId: 'u2', providerId: 'oidc_a', accountId: 'sensitive-subject' },
    ])
    expect(JSON.stringify(result.redacted)).not.toContain('sensitive-subject')
    expect(result.redacted).toEqual({ duplicatePairs: 0, sharedIdentities: 1 })
  })
})
