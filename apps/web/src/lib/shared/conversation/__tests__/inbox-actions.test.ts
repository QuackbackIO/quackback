import { describe, it, expect } from 'vitest'
import {
  INBOX_ACTIONS,
  INBOX_ACTION_GROUP_ORDER,
  isInboxActionEnabled,
  type InboxActionDescriptor,
} from '../inbox-actions'

const byId = (id: string): InboxActionDescriptor => {
  const a = INBOX_ACTIONS.find((x) => x.id === id)
  if (!a) throw new Error(`no action ${id}`)
  return a
}

describe('INBOX_ACTIONS registry', () => {
  it('covers the contract ids', () => {
    const ids = INBOX_ACTIONS.map((a) => a.id)
    for (const id of [
      'reply',
      'assign',
      'assign_team',
      'snooze',
      'priority',
      'close',
      'reopen',
      'next',
      'prev',
      'toggle_select',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('omits the deferred actions (convert-to-ticket, note, macro)', () => {
    const ids = INBOX_ACTIONS.map((a) => a.id)
    expect(ids.some((id) => id.includes('ticket'))).toBe(false)
    expect(ids).not.toContain('note')
    expect(ids).not.toContain('macro')
  })

  it('assigns the contract scopes', () => {
    for (const id of ['reply', 'next', 'prev']) {
      expect(byId(id).scope).toBe('active')
    }
    for (const id of ['assign', 'assign_team', 'snooze', 'priority', 'close', 'reopen']) {
      expect(byId(id).scope).toBe('both')
    }
    expect(byId('toggle_select').scope).toBe('selection')
  })

  it('gives every action a shortcut and keeps the chars unique', () => {
    const keys = INBOX_ACTIONS.map((a) => a.shortcut)
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only uses declared groups', () => {
    for (const a of INBOX_ACTIONS) {
      expect(INBOX_ACTION_GROUP_ORDER).toContain(a.group)
    }
  })
})

describe('isInboxActionEnabled', () => {
  const active = byId('reply') // scope 'active'
  const selection = byId('toggle_select') // scope 'selection'
  const both = byId('assign') // scope 'both'

  it('active scope needs an active conversation', () => {
    expect(isInboxActionEnabled(active, { hasActiveConversation: true, hasSelection: false })).toBe(
      true
    )
    expect(isInboxActionEnabled(active, { hasActiveConversation: false, hasSelection: true })).toBe(
      false
    )
  })

  it('selection scope needs a selection', () => {
    expect(
      isInboxActionEnabled(selection, { hasActiveConversation: false, hasSelection: true })
    ).toBe(true)
    expect(
      isInboxActionEnabled(selection, { hasActiveConversation: true, hasSelection: false })
    ).toBe(false)
  })

  it('both scope needs either an active conversation or a selection', () => {
    expect(isInboxActionEnabled(both, { hasActiveConversation: true, hasSelection: false })).toBe(
      true
    )
    expect(isInboxActionEnabled(both, { hasActiveConversation: false, hasSelection: true })).toBe(
      true
    )
    expect(isInboxActionEnabled(both, { hasActiveConversation: false, hasSelection: false })).toBe(
      false
    )
  })

  it('snooze is disabled when the target includes a ticket (UNIFIED-INBOX-SPEC.md §2.5)', () => {
    const snooze = byId('snooze')
    expect(isInboxActionEnabled(snooze, { hasActiveConversation: true, hasSelection: false })).toBe(
      true
    )
    expect(
      isInboxActionEnabled(snooze, {
        hasActiveConversation: true,
        hasSelection: false,
        hasTicketTarget: true,
      })
    ).toBe(false)
    expect(
      isInboxActionEnabled(snooze, {
        hasActiveConversation: false,
        hasSelection: true,
        hasTicketTarget: true,
      })
    ).toBe(false)
  })

  it('hasTicketTarget never disables a non-snooze action', () => {
    expect(
      isInboxActionEnabled(both, {
        hasActiveConversation: true,
        hasSelection: false,
        hasTicketTarget: true,
      })
    ).toBe(true)
  })
})
