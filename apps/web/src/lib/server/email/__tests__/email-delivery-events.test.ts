import { describe, expect, it } from 'vitest'
import { parseDeliveryEvent } from '../email-delivery-events'

describe('parseDeliveryEvent', () => {
  it('reads a Resend bounce', () => {
    expect(parseDeliveryEvent({ type: 'email.bounced', data: { email_id: 're_123' } })).toEqual({
      messageId: 're_123',
      event: 'bounce',
    })
  })

  it('reads a Resend complaint', () => {
    expect(parseDeliveryEvent({ type: 'email.complained', data: { email_id: 're_9' } })).toEqual({
      messageId: 're_9',
      event: 'complaint',
    })
  })

  it('reads an SES bounce, including SNS wrapping', () => {
    const ses = {
      notificationType: 'Bounce',
      mail: { messageId: '010001-ses' },
    }
    expect(parseDeliveryEvent(ses)).toEqual({ messageId: '010001-ses', event: 'bounce' })
    expect(parseDeliveryEvent({ Type: 'Notification', Message: JSON.stringify(ses) })).toEqual({
      messageId: '010001-ses',
      event: 'bounce',
    })
  })

  it('ignores inbound receipts and junk', () => {
    expect(parseDeliveryEvent({ type: 'email.received', data: { email_id: 'x' } })).toBeNull()
    expect(parseDeliveryEvent(null)).toBeNull()
    expect(parseDeliveryEvent({ foo: 1 })).toBeNull()
  })
})
