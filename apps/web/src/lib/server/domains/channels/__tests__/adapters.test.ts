import { describe, expect, it } from 'vitest'
import { getChannelAdapter, listChannelAdapters } from '../index'

describe('channel adapters', () => {
  it('registers one adapter per descriptor id', () => {
    const ids = listChannelAdapters().map((a) => a.id)
    expect(ids).toEqual(['messenger', 'email'])
    expect(getChannelAdapter('email')?.deliverLifecycleEvent).toEqual(expect.any(Function))
    expect(getChannelAdapter('messenger')?.deliverCsatRequest).toEqual(expect.any(Function))
  })
})
