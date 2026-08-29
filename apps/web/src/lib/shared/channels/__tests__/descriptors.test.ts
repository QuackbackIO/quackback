import { afterEach, describe, expect, it } from 'vitest'
import {
  channelFromVisitorTransport,
  getChannelDescriptor,
  listChannelDescriptors,
  parseChannel,
  registerChannelDescriptor,
  unregisterChannelDescriptor,
} from '../index'
import { inboxChannelFilterSchema } from '../inbox-filter'
import { TEST_CHANNEL_ID, testChannelDescriptor } from './test-channel.fixture'

describe('channel descriptors', () => {
  it('registers messenger and email with the spec capabilities', () => {
    const ids = listChannelDescriptors().map((d) => d.id)
    expect(ids).toEqual(['messenger', 'email', 'github'])
    expect(getChannelDescriptor('messenger')).toMatchObject({
      surface: 'ours',
      reopenOnReply: 'configurable',
      accountRoles: [],
    })
    expect(getChannelDescriptor('email')).toMatchObject({
      surface: 'theirs',
      reopenOnReply: 'always',
      accountRoles: ['inbound', 'sending'],
      addressing: 'email',
    })
    expect(getChannelDescriptor('github')).toMatchObject({
      surface: 'theirs',
      threading: 'per-thread',
      accountRoles: ['connection'],
      addressing: 'thread',
      reopenOnReply: 'never',
      closeSurface: 'native',
      nativeObject: 'issue',
    })
  })

  it('promotes the last visitor transport without hardcoding email/messenger', () => {
    expect(channelFromVisitorTransport('email')).toBe('email')
    expect(channelFromVisitorTransport(undefined)).toBe('messenger')
    expect(channelFromVisitorTransport('widget')).toBe('messenger')
  })

  it('parses inbox channel values from the registry', () => {
    expect(parseChannel('messenger')).toBe('messenger')
    expect(parseChannel('email')).toBe('email')
    expect(parseChannel('github')).toBe('github')
    expect(parseChannel('sms')).toBeUndefined()
    expect(parseChannel(undefined)).toBeUndefined()
    expect(inboxChannelFilterSchema.parse('email')).toBe('email')
    expect(inboxChannelFilterSchema.parse('github')).toBe('github')
    expect(() => inboxChannelFilterSchema.parse('sms')).toThrow()
  })
})

describe('test_channel fixture (tests only)', () => {
  afterEach(() => {
    unregisterChannelDescriptor(TEST_CHANNEL_ID)
  })

  it('is accepted by parseChannel only after it is registered', () => {
    expect(parseChannel(TEST_CHANNEL_ID)).toBeUndefined()
    expect(() => inboxChannelFilterSchema.parse(TEST_CHANNEL_ID)).toThrow()

    registerChannelDescriptor(testChannelDescriptor)

    expect(getChannelDescriptor(TEST_CHANNEL_ID)?.label).toBe('Test channel')
    expect(parseChannel(TEST_CHANNEL_ID)).toBe(TEST_CHANNEL_ID)
    expect(inboxChannelFilterSchema.parse(TEST_CHANNEL_ID)).toBe(TEST_CHANNEL_ID)
  })
})
