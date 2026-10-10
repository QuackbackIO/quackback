import { describe, expect, it } from 'vitest'
import { EMAIL_BILLABLE, METERED_EMAIL_TYPES, isEmailBillable } from '../mail-class'

describe('email meter classes', () => {
  it('meters changelog and status-page subscriber sends only', () => {
    const billed = Object.entries(EMAIL_BILLABLE)
      .filter(([, billable]) => billable)
      .map(([type]) => type)
      .sort()
    expect(billed).toEqual([...METERED_EMAIL_TYPES].sort())
  })

  it('does not meter inbox, ticket, or feedback status mail', () => {
    expect(isEmailBillable('ConversationMessageEmail')).toBe(false)
    expect(isEmailBillable('ConversationReplyEmail')).toBe(false)
    expect(isEmailBillable('TicketEventEmail')).toBe(false)
    expect(isEmailBillable('StatusChangeEmail')).toBe(false)
    expect(isEmailBillable('CsatRequestEmail')).toBe(false)
  })
})
