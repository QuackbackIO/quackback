import { describe, expect, it } from 'vitest'
import { evaluateAutoAckGuards } from '../conversation.auto-ack'
import type { ParsedInboundEmail } from '../conversation.email-inbound'

function parsed(over: Partial<ParsedInboundEmail> = {}): ParsedInboundEmail {
  return {
    from: 'Priya <priya@customer.com>',
    toAddresses: ['support@acme.com'],
    ccAddresses: [],
    replyToAddresses: [],
    subject: 'Help',
    text: 'Hi',
    html: undefined,
    messageId: 'cust@x',
    emailId: null,
    inReplyTo: null,
    references: [],
    autoSubmitted: null,
    autoResponseSuppress: null,
    precedence: null,
    hasListHeaders: false,
    authenticationResults: null,
    ...over,
  }
}

describe('evaluateAutoAckGuards', () => {
  it('allows a normal customer message', () => {
    expect(evaluateAutoAckGuards(parsed(), { EMAIL_FROM: 'noreply@acme.com' })).toBeNull()
  })

  it('suppresses auto-submitted, bulk, list, and own-domain mail', () => {
    expect(evaluateAutoAckGuards(parsed({ autoSubmitted: 'auto-replied' }))).toBe('auto_submitted')
    expect(evaluateAutoAckGuards(parsed({ precedence: 'bulk' }))).toBe('precedence')
    expect(evaluateAutoAckGuards(parsed({ hasListHeaders: true }))).toBe('list')
    expect(
      evaluateAutoAckGuards(parsed({ from: 'bot@acme.com' }), { EMAIL_FROM: 'noreply@acme.com' })
    ).toBe('own_domain')
  })
})
