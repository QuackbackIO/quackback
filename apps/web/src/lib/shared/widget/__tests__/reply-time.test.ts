import { describe, expect, it } from 'vitest'
import { REPLY_TIMES, DEFAULT_REPLY_TIME, resolveReplyTime } from '../reply-time'

describe('resolveReplyTime', () => {
  it('defaults to under an hour', () => {
    expect(DEFAULT_REPLY_TIME).toBe('hour')
  })

  it('treats an absent or unknown value as the default', () => {
    expect(resolveReplyTime(undefined)).toBe('hour')
    expect(resolveReplyTime(null)).toBe('hour')
    expect(resolveReplyTime('weeks')).toBe('hour')
    expect(resolveReplyTime(3)).toBe('hour')
  })

  it.each(REPLY_TIMES)('keeps the stored value %s', (value) => {
    expect(resolveReplyTime(value)).toBe(value)
  })

  it('offers off alongside the reply expectations', () => {
    expect([...REPLY_TIMES]).toEqual(['minutes', 'hour', 'hours', 'day', 'off'])
  })
})
