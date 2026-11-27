import { describe, expect, it } from 'vitest'
import { buildReplyTimeMessage } from '../reply-time-message'

describe('buildReplyTimeMessage', () => {
  it('words the online line from the usual reply time, under an hour when unset', () => {
    expect(buildReplyTimeMessage(null)).toEqual({
      status: 'online',
      content: "We're online, typically replies in under an hour.",
    })
    expect(buildReplyTimeMessage(null, 'minutes').content).toBe(
      "We're online, typically replies in a few minutes."
    )
    expect(buildReplyTimeMessage(null, 'hours').content).toBe(
      "We're online, typically replies in a few hours."
    )
    expect(buildReplyTimeMessage(null, 'day').content).toBe(
      "We're online, typically replies within a day."
    )
    expect(buildReplyTimeMessage(null, 'off').content).toBe("We're online.")
  })

  it('keeps the away line whatever the reply time', () => {
    // Enabled with no windows: never open.
    const closed = { enabled: true, timezone: 'UTC', intervals: [] }
    const away = buildReplyTimeMessage(closed, 'minutes')
    expect(away.status).toBe('away')
    expect(away.content).toBe(
      "We're away right now. We'll get back to you as soon as we're back online."
    )
  })
})
