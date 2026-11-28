/**
 * Ticket due dates in the workflow authoring schema: the set_ticket_due_date
 * action (a strict union of an absolute instant or null, and a relative
 * offset, exactly one of the two) and the send_ticket_form node's
 * `askDueDate` flag, which zod must keep rather than strip on save.
 */
import { describe, it, expect } from 'vitest'
import { workflowGraphSchema, MAX_DUE_OFFSET_SECONDS } from '../workflow.schemas'

describe('set_ticket_due_date action: relative + absolute', () => {
  const graphWithAction = (action: unknown) => ({
    nodes: [{ id: 'a', type: 'action', action }],
    edges: [],
  })
  const parses = (action: unknown) => workflowGraphSchema.safeParse(graphWithAction(action)).success

  it('accepts a relative offset at 60 seconds and at MAX_DUE_OFFSET_SECONDS', () => {
    expect(MAX_DUE_OFFSET_SECONDS).toBe(365 * 24 * 60 * 60)
    expect(parses({ type: 'set_ticket_due_date', seconds: 60 })).toBe(true)
    expect(parses({ type: 'set_ticket_due_date', seconds: MAX_DUE_OFFSET_SECONDS })).toBe(true)
  })

  it('rejects a relative offset under a minute, over the max, or not a whole number', () => {
    expect(parses({ type: 'set_ticket_due_date', seconds: 59 })).toBe(false)
    expect(parses({ type: 'set_ticket_due_date', seconds: 0 })).toBe(false)
    expect(parses({ type: 'set_ticket_due_date', seconds: MAX_DUE_OFFSET_SECONDS + 1 })).toBe(false)
    expect(parses({ type: 'set_ticket_due_date', seconds: 90.5 })).toBe(false)
  })

  it('accepts an absolute ISO timestamp, and null to clear the date', () => {
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: '2026-08-01T17:00:00Z' })).toBe(true)
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: '2026-08-01T17:00:00.000Z' })).toBe(true)
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: null })).toBe(true)
  })

  it('rejects a malformed absolute timestamp', () => {
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: 'next friday' })).toBe(false)
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: '' })).toBe(false)
  })

  it('rejects an action carrying both dueAtIso and seconds, or neither (matches no branch)', () => {
    expect(parses({ type: 'set_ticket_due_date', dueAtIso: null, seconds: 3600 })).toBe(false)
    expect(parses({ type: 'set_ticket_due_date' })).toBe(false)
  })
})

describe('send_ticket_form: askDueDate', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
  const graphWithForm = (extra: Record<string, unknown>) => ({
    nodes: [{ id: 'f', type: 'send_ticket_form', body: doc, ...extra }],
    edges: [],
  })

  it('keeps askDueDate on save (zod would otherwise strip the unknown key)', () => {
    const parsed = workflowGraphSchema.safeParse(graphWithForm({ askDueDate: true }))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.nodes[0]).toMatchObject({ askDueDate: true })
  })

  it('leaves askDueDate absent when the form never set it', () => {
    const parsed = workflowGraphSchema.safeParse(graphWithForm({}))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.nodes[0]).not.toHaveProperty('askDueDate')
  })

  it('rejects a non-boolean askDueDate', () => {
    expect(workflowGraphSchema.safeParse(graphWithForm({ askDueDate: 'yes' })).success).toBe(false)
  })
})
