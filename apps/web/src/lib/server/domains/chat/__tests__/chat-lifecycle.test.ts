import { describe, it, expect } from 'vitest'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
} from '../chat.lifecycle'

describe('applyVisitorReopenStatus', () => {
  it('a visitor message always surfaces the thread (returns open)', () => {
    expect(applyVisitorReopenStatus()).toBe('open')
  })
})

describe('applyAgentReopenStatus', () => {
  it('reopens a closed thread but preserves pending', () => {
    expect(applyAgentReopenStatus('closed')).toBe('open')
    // An agent reply does NOT clear "waiting on customer" — only a visitor does.
    expect(applyAgentReopenStatus('pending')).toBe('pending')
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
    expect(resolvedAtForStatus('pending', now)).toBeNull()
  })
})

describe('shouldRequeueOnAgentOffline', () => {
  it('re-queues an open conversation the agent never answered', () => {
    expect(shouldRequeueOnAgentOffline('open', false)).toBe(true)
  })

  it('leaves a conversation the agent has already replied to', () => {
    // The agent owns an engaged thread; it stays assigned even when they step away.
    expect(shouldRequeueOnAgentOffline('open', true)).toBe(false)
  })

  it('never re-queues a closed or pending conversation', () => {
    expect(shouldRequeueOnAgentOffline('closed', false)).toBe(false)
    expect(shouldRequeueOnAgentOffline('pending', false)).toBe(false)
  })
})
