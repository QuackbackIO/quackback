/**
 * Pure resolution tests for the post- and ticket-side status mappings stored
 * in integrations.config (statusMappings / ticketStatusMappings).
 */
import { describe, it, expect } from 'vitest'
import { resolveStatusMapping, resolveTicketStatusMapping } from '../status-mapping'

describe('resolveStatusMapping', () => {
  it('resolves a mapped external status', () => {
    expect(resolveStatusMapping('Closed', { Closed: 'post_status_x' })).toBe('post_status_x')
  })

  it('returns null for missing mappings, explicit ignores, and undefined config', () => {
    expect(resolveStatusMapping('Closed', undefined)).toBeNull()
    expect(resolveStatusMapping('Closed', {})).toBeNull()
    expect(resolveStatusMapping('Closed', { Closed: null })).toBeNull()
  })

  it('is case-sensitive, as received from the platform', () => {
    expect(resolveStatusMapping('closed', { Closed: 'post_status_x' })).toBeNull()
  })
})

describe('resolveTicketStatusMapping', () => {
  it('resolves a mapped external status to a ticket status id', () => {
    expect(resolveTicketStatusMapping('Closed', { Closed: 'ticket_status_x' })).toBe(
      'ticket_status_x'
    )
  })

  it('returns null for missing mappings, explicit ignores, and undefined config', () => {
    expect(resolveTicketStatusMapping('Closed', undefined)).toBeNull()
    expect(resolveTicketStatusMapping('Closed', {})).toBeNull()
    expect(resolveTicketStatusMapping('Closed', { Closed: null })).toBeNull()
  })
})
