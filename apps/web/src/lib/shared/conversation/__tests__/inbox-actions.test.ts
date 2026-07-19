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
      'copilot',
      'assign',
      'assign_team',
      'snooze',
      'priority',
      'close',
      'reopen',
      'create_ticket',
      'next',
      'prev',
      'toggle_select',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('omits the still-deferred actions (note, macro)', () => {
    const ids = INBOX_ACTIONS.map((a) => a.id)
    expect(ids).not.toContain('note')
    expect(ids).not.toContain('macro')
  })

  it('assigns the contract scopes', () => {
    for (const id of ['reply', 'copilot', 'next', 'prev']) {
      expect(byId(id).scope).toBe('active')
    }
    for (const id of [
      'assign',
      'assign_team',
      'snooze',
      'priority',
      'close',
      'reopen',
      'create_ticket',
    ]) {
      expect(byId(id).scope).toBe('both')
    }
    expect(byId('toggle_select').scope).toBe('selection')
  })

  it('gives every keyed action a shortcut and keeps the chars unique', () => {
    // open_ticket is deliberately keyless (palette-only — see its descriptor).
    const keyed = INBOX_ACTIONS.filter((a) => a.id !== 'open_ticket')
    const keys = keyed.map((a) => a.shortcut)
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(byId('open_ticket').shortcut).toBeUndefined()
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

  it('hasTicketTarget never disables assign/priority/close/reopen', () => {
    expect(
      isInboxActionEnabled(both, {
        hasActiveConversation: true,
        hasSelection: false,
        hasTicketTarget: true,
      })
    ).toBe(true)
  })

  it('create_ticket is available with no target at all (a bare create)', () => {
    const createTicket = byId('create_ticket')
    expect(
      isInboxActionEnabled(createTicket, { hasActiveConversation: false, hasSelection: false })
    ).toBe(true)
  })

  it('create_ticket is available for a conversation target', () => {
    const createTicket = byId('create_ticket')
    expect(
      isInboxActionEnabled(createTicket, { hasActiveConversation: true, hasSelection: false })
    ).toBe(true)
  })

  it('create_ticket is disabled once the target is a ticket', () => {
    const createTicket = byId('create_ticket')
    expect(
      isInboxActionEnabled(createTicket, {
        hasActiveConversation: true,
        hasSelection: false,
        hasTicketTarget: true,
      })
    ).toBe(false)
  })

  it('create_ticket is disabled when the active conversation already links a ticket', () => {
    const createTicket = byId('create_ticket')
    expect(
      isInboxActionEnabled(createTicket, {
        hasActiveConversation: true,
        hasSelection: false,
        hasLinkedTicket: true,
      })
    ).toBe(false)
    // …and a bare create with nothing open is unaffected (no orphan risk).
    expect(
      isInboxActionEnabled(createTicket, {
        hasActiveConversation: false,
        hasSelection: false,
        hasLinkedTicket: false,
      })
    ).toBe(true)
  })

  it('open_ticket is enabled exactly when the active conversation links a ticket', () => {
    const openTicket = byId('open_ticket')
    expect(
      isInboxActionEnabled(openTicket, {
        hasActiveConversation: true,
        hasSelection: false,
        hasLinkedTicket: true,
      })
    ).toBe(true)
    expect(
      isInboxActionEnabled(openTicket, { hasActiveConversation: true, hasSelection: false })
    ).toBe(false)
    expect(
      isInboxActionEnabled(openTicket, { hasActiveConversation: false, hasSelection: false })
    ).toBe(false)
  })

  it('copilot needs copilotAvailable AND an active item', () => {
    const copilot = byId('copilot')
    expect(
      isInboxActionEnabled(copilot, {
        hasActiveConversation: true,
        hasSelection: false,
        copilotAvailable: true,
      })
    ).toBe(true)
    // Tab unavailable (flag off / no permission / <xl viewport): disabled even
    // with an active item.
    expect(
      isInboxActionEnabled(copilot, { hasActiveConversation: true, hasSelection: false })
    ).toBe(false)
    // Available but nothing open: there is no item-scoped panel to ask about.
    expect(
      isInboxActionEnabled(copilot, {
        hasActiveConversation: false,
        hasSelection: true,
        copilotAvailable: true,
      })
    ).toBe(false)
  })

  it('copilot works for a ticket target too (the panel is item-scoped, both kinds)', () => {
    const copilot = byId('copilot')
    expect(
      isInboxActionEnabled(copilot, {
        hasActiveConversation: true,
        hasSelection: false,
        hasTicketTarget: true,
        copilotAvailable: true,
      })
    ).toBe(true)
  })
})
