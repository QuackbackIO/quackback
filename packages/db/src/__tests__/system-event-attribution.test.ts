import { describe, it, expect } from 'vitest'
import { withWorkflowAttribution } from '../types'
import type { ConversationSystemEvent } from '../types'

describe('withWorkflowAttribution', () => {
  it("stamps the firing workflow's name onto the event", () => {
    const event: ConversationSystemEvent = { kind: 'chat_ended' }
    expect(withWorkflowAttribution(event, 'Auto-close after CSAT')).toEqual({
      kind: 'chat_ended',
      workflowName: 'Auto-close after CSAT',
    })
  })

  it('leaves the event untouched when there is no workflow to name (manual action)', () => {
    const event: ConversationSystemEvent = { kind: 'assigned', agentName: 'Rae' }
    expect(withWorkflowAttribution(event, undefined)).toEqual(event)
    expect(withWorkflowAttribution(event, null)).toEqual(event)
    expect(withWorkflowAttribution(event, '   ')).toEqual(event)
  })

  it('trims the workflow name and does not mutate the input event', () => {
    const event: ConversationSystemEvent = { kind: 'chat_reopened' }
    const stamped = withWorkflowAttribution(event, '  Win-back follow-up  ')
    expect(stamped.workflowName).toBe('Win-back follow-up')
    expect(event).toEqual({ kind: 'chat_reopened' })
  })
})
