/**
 * The real-time bus has no authorization layer of its own: whatever reaches a
 * channel is written straight to every SSE stream subscribed to it. So the
 * channel name is the boundary. `conversation:inbox` is one literal shared by
 * every agent inbox in the process — unnamespaced, one workspace's messages
 * stream into another's inbox.
 *
 * Namespacing happens on the wire, in `publish`/`subscribe`, not in the naming
 * helpers, so these assert the wire names actually handed to Redis.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  published: [] as Array<{ channel: string; payload: string }>,
  subscribed: [] as string[],
  unsubscribed: [] as string[],
  handlers: new Map<string, (channel: string, message: string) => void>(),
}))

vi.mock('@/lib/server/redis', () => ({
  getRedis: () => ({
    publish: async (channel: string, payload: string) => {
      hoisted.published.push({ channel, payload })
      return 1
    },
  }),
}))

vi.mock('ioredis', () => ({
  default: class MockSubscriber {
    on(event: string, fn: (channel: string, message: string) => void) {
      hoisted.handlers.set(event, fn)
      return this
    }
    async subscribe(channel: string) {
      hoisted.subscribed.push(channel)
    }
    async unsubscribe(channel: string) {
      hoisted.unsubscribed.push(channel)
    }
  },
}))

vi.mock('@/lib/server/config', () => ({ config: { redisUrl: 'redis://localhost:6379' } }))

const { publish, subscribe } = await import('../pubsub')
const { CONVERSATION_INBOX_CHANNEL } = await import('../conversation-channels')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

beforeEach(() => {
  hoisted.published.length = 0
  hoisted.subscribed.length = 0
  hoisted.unsubscribed.length = 0
})

describe('publish', () => {
  it('namespaces the shared inbox channel by tenant', () => {
    withTenant('tenant-alpha', () => publish(CONVERSATION_INBOX_CHANNEL, { kind: 'ping' }))

    expect(hoisted.published.map((p) => p.channel)).toEqual(['t:tenant-alpha:conversation:inbox'])
  })

  it('sends two tenants to different channels for the same logical name', () => {
    withTenant('tenant-alpha', () => publish(CONVERSATION_INBOX_CHANNEL, { kind: 'a' }))
    withTenant('tenant-bravo', () => publish(CONVERSATION_INBOX_CHANNEL, { kind: 'b' }))

    expect(hoisted.published.map((p) => p.channel)).toEqual([
      't:tenant-alpha:conversation:inbox',
      't:tenant-bravo:conversation:inbox',
    ])
  })

  it('uses the single-tenant namespace with no scope', () => {
    publish(CONVERSATION_INBOX_CHANNEL, { kind: 'ping' })

    expect(hoisted.published.map((p) => p.channel)).toEqual(['t:_:conversation:inbox'])
  })
})

describe('subscribe', () => {
  it('subscribes to the tenant wire channel and unsubscribes from the same one', async () => {
    const unsub = await withTenant('tenant-alpha', () =>
      subscribe([CONVERSATION_INBOX_CHANNEL], () => {})
    )

    expect(hoisted.subscribed).toEqual(['t:tenant-alpha:conversation:inbox'])

    // The teardown runs long after the request scope closed. It must still
    // address the channel it subscribed to, not the unscoped one.
    await unsub()
    expect(hoisted.unsubscribed).toEqual(['t:tenant-alpha:conversation:inbox'])
  })

  it('reports the logical channel to the handler, not the wire name', async () => {
    const seen: string[] = []
    await withTenant('tenant-alpha', () =>
      subscribe([CONVERSATION_INBOX_CHANNEL], (channel) => seen.push(channel))
    )

    const onMessage = hoisted.handlers.get('message')!
    onMessage('t:tenant-alpha:conversation:inbox', '{}')

    expect(seen).toEqual([CONVERSATION_INBOX_CHANNEL])
  })

  it('does not deliver another tenant published frame', async () => {
    const alphaSeen: string[] = []
    await withTenant('tenant-alpha', () =>
      subscribe([CONVERSATION_INBOX_CHANNEL], (_c, message) => alphaSeen.push(message))
    )

    const onMessage = hoisted.handlers.get('message')!
    // What bravo's publish would actually put on the wire.
    withTenant('tenant-bravo', () => publish(CONVERSATION_INBOX_CHANNEL, { kind: 'secret' }))
    for (const frame of hoisted.published) onMessage(frame.channel, frame.payload)

    expect(alphaSeen).toEqual([])
  })
})
