/**
 * What an outbound sync is sourced from, which decides what the ledger
 * cancels: a public reply on a ticket is its own source (removed or internal
 * since: not sent), while a note and a deleted reply stay with their ticket.
 */
import { describe, it, expect } from 'vitest'
import { hookSource } from '../hooks'
import type { HookJobData } from '@/lib/server/events/hook-job'

const job = (type: string, data: Record<string, unknown>) =>
  ({
    hookType: 'slack',
    event: { id: 'evt', type, timestamp: new Date().toISOString(), actor: {}, data },
    target: {},
    config: {},
  }) as unknown as HookJobData

describe('hookSource', () => {
  const ticket = { id: 'ticket_1' }
  it.each([
    'ticket.replied',
    'ticket.reply_updated',
    'ticket.attachment_added',
    'ticket.attachment_removed',
  ])('sources %s from the reply', (type) => {
    expect(hookSource(job(type, { ticket, messageId: 'conversation_msg_1' }))).toEqual({
      sourceType: 'message',
      sourceId: 'conversation_msg_1',
    })
  })

  it.each(['ticket.note_added', 'ticket.reply_deleted'])('sources %s from the ticket', (type) => {
    expect(hookSource(job(type, { ticket, messageId: 'conversation_msg_1' }))).toEqual({
      sourceType: 'ticket',
      sourceId: 'ticket_1',
    })
  })
})
