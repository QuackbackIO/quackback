import { describe, it, expect } from 'vitest'
import { mergeChatRecipients } from '../chat.recipients'

describe('mergeChatRecipients', () => {
  it('unions team + watchers, deduped by principal id', () => {
    const team = [{ principalId: 'p1', email: 'a@x.com', name: 'A' }]
    const watchers = [
      { principalId: 'p1', email: 'a@x.com', name: 'A' }, // dup of team
      { principalId: 'p2', email: 'b@x.com', name: 'B' },
    ]
    const merged = mergeChatRecipients(team, watchers)
    expect(merged.map((r) => r.principalId)).toEqual(['p1', 'p2'])
  })

  it('returns just watchers when the team list is empty (rate-limited broadcast)', () => {
    const merged = mergeChatRecipients([], [{ principalId: 'p2', email: null, name: null }])
    expect(merged).toEqual([{ principalId: 'p2', email: null, name: null }])
  })

  it('is empty when both are empty', () => {
    expect(mergeChatRecipients([], [])).toEqual([])
  })
})
