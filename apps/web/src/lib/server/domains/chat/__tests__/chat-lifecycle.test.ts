import { describe, it, expect } from 'vitest'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  resolvedAtForStatus,
} from '../chat.lifecycle'

describe('applyVisitorReopenStatus', () => {
  it('a visitor message always surfaces the thread (returns open)', () => {
    expect(applyVisitorReopenStatus()).toBe('open')
  })
})

describe('applyAgentReopenStatus', () => {
  it('reopens a closed thread but preserves pending and snoozed', () => {
    expect(applyAgentReopenStatus('closed')).toBe('open')
    // An agent reply does NOT clear "waiting on customer" — only a visitor does.
    expect(applyAgentReopenStatus('pending')).toBe('pending')
    expect(applyAgentReopenStatus('snoozed')).toBe('snoozed')
    expect(applyAgentReopenStatus('open')).toBe('open')
  })
})

describe('resolvedAtForStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z')
  it('stamps the resolved time when closed', () => {
    expect(resolvedAtForStatus('closed', now)).toBe(now)
  })
  it('clears it for every non-closed status', () => {
    expect(resolvedAtForStatus('open', now)).toBeNull()
    expect(resolvedAtForStatus('snoozed', now)).toBeNull()
    expect(resolvedAtForStatus('pending', now)).toBeNull()
  })
})
