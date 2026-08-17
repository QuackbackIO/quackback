import { describe, expect, it } from 'vitest'
import { channelFromVisitorTransport, getChannelDescriptor, listChannelDescriptors } from '../index'

describe('channel descriptors', () => {
  it('registers messenger and email with the spec capabilities', () => {
    const ids = listChannelDescriptors().map((d) => d.id)
    expect(ids).toEqual(['messenger', 'email'])
    expect(getChannelDescriptor('messenger')).toMatchObject({
      surface: 'ours',
      reopenOnReply: 'configurable',
      accountRoles: [],
    })
    expect(getChannelDescriptor('email')).toMatchObject({
      surface: 'theirs',
      reopenOnReply: 'always',
      accountRoles: ['inbound', 'sending'],
    })
  })

  it('promotes the last visitor transport without hardcoding email/messenger', () => {
    expect(channelFromVisitorTransport('email')).toBe('email')
    expect(channelFromVisitorTransport(undefined)).toBe('messenger')
    expect(channelFromVisitorTransport('widget')).toBe('messenger')
  })
})
