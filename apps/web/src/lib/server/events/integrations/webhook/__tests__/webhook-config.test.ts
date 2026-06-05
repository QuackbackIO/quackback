import { describe, it, expect } from 'vitest'
import { EVENT_TYPES } from '../../../types'
import { WEBHOOK_EVENT_CONFIG } from '../constants'

describe('WEBHOOK_EVENT_CONFIG', () => {
  it('exposes every conversation/message event type (no drift on the chat family)', () => {
    const configIds = new Set<string>(WEBHOOK_EVENT_CONFIG.map((c) => c.id))
    const chatTypes = EVENT_TYPES.filter(
      (t) => t.startsWith('conversation.') || t.startsWith('message.')
    )
    for (const t of chatTypes) expect(configIds.has(t)).toBe(true)
  })

  it('only references valid event types', () => {
    const valid = new Set<string>(EVENT_TYPES)
    for (const c of WEBHOOK_EVENT_CONFIG) expect(valid.has(c.id)).toBe(true)
  })

  it('labels the internal-note topic as private', () => {
    const note = WEBHOOK_EVENT_CONFIG.find((c) => c.id === 'message.note_created')
    expect(note).toBeDefined()
    expect(`${note!.label} ${note!.description}`.toLowerCase()).toContain('internal')
  })
})
