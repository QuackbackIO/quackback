import { describe, expect, it } from 'vitest'
import { resolveEmailAutoAck } from '../settings.email-auto-ack'

describe('resolveEmailAutoAck', () => {
  it('defaults off', () => {
    expect(resolveEmailAutoAck(null)).toEqual({ enabled: false })
    expect(resolveEmailAutoAck('{}')).toEqual({ enabled: false })
  })

  it('reads the metadata bag', () => {
    expect(resolveEmailAutoAck(JSON.stringify({ emailAutoAck: { enabled: true } }))).toEqual({
      enabled: true,
    })
  })
})
