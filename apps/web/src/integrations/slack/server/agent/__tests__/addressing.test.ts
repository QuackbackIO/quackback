import { expect, it } from 'vitest'
import { isDuplicateSlackMentionEvent, shouldEnqueueSlackEvent } from '../addressing'

it('drops channel message events that duplicate an app_mention, but not DMs', () => {
  expect(
    isDuplicateSlackMentionEvent(
      { type: 'message', channel_type: 'channel', text: 'hi <@Ubot>' },
      'Ubot'
    )
  ).toBe(true)
  expect(
    isDuplicateSlackMentionEvent(
      { type: 'message', channel_type: 'im', text: 'hi <@Ubot>' },
      'Ubot'
    )
  ).toBe(false)
  expect(
    isDuplicateSlackMentionEvent(
      { type: 'message', channel_type: 'channel', text: 'what about billing?' },
      'Ubot'
    )
  ).toBe(false)
  expect(isDuplicateSlackMentionEvent({ type: 'app_mention', text: '<@Ubot> hi' }, 'Ubot')).toBe(
    false
  )
})

it('enqueues subscribed lifecycle events the worker handles', () => {
  for (const type of [
    'app_uninstalled',
    'tokens_revoked',
    'reaction_added',
    'app_home_opened',
    'agent_session_stopped',
  ])
    expect(shouldEnqueueSlackEvent({ type })).toBe(true)
  expect(shouldEnqueueSlackEvent({ type: 'member_joined_channel' })).toBe(false)
  expect(shouldEnqueueSlackEvent({ type: 'reaction_added', bot_id: 'B1' })).toBe(false)
  expect(
    shouldEnqueueSlackEvent({
      type: 'message',
      channel_type: 'channel',
      thread_ts: '1.2',
      bot_profile: { name: 'Quinn' },
    })
  ).toBe(false)
})

it('enqueues mentions, DMs and threaded channel replies only', () => {
  expect(shouldEnqueueSlackEvent({ type: 'app_mention' })).toBe(true)
  expect(shouldEnqueueSlackEvent({ type: 'message', channel_type: 'im' })).toBe(true)
  expect(
    shouldEnqueueSlackEvent({ type: 'message', channel_type: 'channel', thread_ts: '1.2' })
  ).toBe(true)
  expect(shouldEnqueueSlackEvent({ type: 'message', channel_type: 'channel' })).toBe(false)
  expect(
    shouldEnqueueSlackEvent({ type: 'message', channel_type: 'im', subtype: 'bot_message' })
  ).toBe(false)
})
