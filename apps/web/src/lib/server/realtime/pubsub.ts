/**
 * Real-time fan-out bus for conversations.
 *
 * Postgres is the durable source of truth; this layer is fire-and-forget
 * delivery only. A message written on one app replica must reach an SSE
 * connection pinned to another replica, so we bridge them over Redis
 * (Dragonfly) pub/sub rather than an in-process EventEmitter.
 *
 * ioredis connections in subscriber mode are exclusive — a connection that
 * has run SUBSCRIBE cannot issue GET/SET/PUBLISH. So the subscribe side uses
 * its OWN dedicated connection here, while the publish side reuses the shared
 * cache client from redis.ts. A single shared subscriber connection is
 * multiplexed across all SSE streams via an in-process listener registry, so
 * N concurrent streams cost one Redis connection, not N.
 */
import Redis from 'ioredis'
import { config } from '../config'
import { getRedis } from '../redis'
import { tenantKey } from '../tenancy/tenant-keyed'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'pubsub' })

// channel -> set of in-process listeners. The shared subscriber connection is
// SUBSCRIBEd to a channel exactly once (when its first listener registers) and
// UNSUBSCRIBEd when the last listener leaves.
const listeners = new Map<string, Set<(message: string) => void>>()

let subscriber: Redis | null = null

function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(config.redisUrl, {
      // A subscriber connection must not give up on its commands — it lives
      // for the life of the process behind the registry.
      maxRetriesPerRequest: null,
      connectTimeout: 5_000,
    })
    subscriber.on('message', (channel: string, message: string) => {
      const set = listeners.get(channel)
      if (!set) return
      for (const fn of set) {
        try {
          fn(message)
        } catch (err) {
          log.error({ err, channel }, 'listener threw')
        }
      }
    })
    subscriber.on('error', (err) => {
      log.error({ err }, 'subscriber connection error')
    })
  }
  return subscriber
}

/**
 * Subscribe to one or more channels. The handler is invoked with the raw
 * string payload for every published message on any of those channels.
 * Returns an async unsubscribe function that removes this handler and drops
 * the underlying Redis subscription once no listeners remain for a channel.
 *
 * Callers name LOGICAL channels (`conversation:inbox`, `conversation:<id>`);
 * the tenant namespace is applied here, on the wire. Doing it at the naming
 * helpers instead would leave one shared Redis carrying `conversation:inbox`
 * for every tenant at once — an agent inbox that streams other workspaces'
 * messages, on a bus that has no authorization layer of its own. The wire
 * name is resolved at subscribe time, while the request scope that named the
 * tenant is still open; an SSE stream outlives that scope by minutes.
 */
export async function subscribe(
  channels: string[],
  onMessage: (channel: string, message: string) => void
): Promise<() => Promise<void>> {
  const sub = getSubscriber()
  const registered: Array<{ wire: string; fn: (message: string) => void }> = []

  for (const channel of channels) {
    const wire = tenantKey(channel)
    // The handler is told the logical name it asked for, not the wire name.
    const fn = (message: string) => onMessage(channel, message)
    let set = listeners.get(wire)
    if (!set) {
      set = new Set()
      listeners.set(wire, set)
      await sub.subscribe(wire)
    }
    set.add(fn)
    registered.push({ wire, fn })
  }

  return async () => {
    for (const { wire, fn } of registered) {
      const set = listeners.get(wire)
      if (!set) continue
      set.delete(fn)
      if (set.size === 0) {
        listeners.delete(wire)
        try {
          await sub.unsubscribe(wire)
        } catch (err) {
          log.warn({ err, channel: wire }, 'unsubscribe failed')
        }
      }
    }
  }
}

/**
 * Publish a payload to a channel. Fire-and-forget: a delivery failure must
 * never break the write that triggered it (the message is already committed
 * to Postgres). Uses the shared cache client, NOT the subscriber connection.
 */
export function publish(channel: string, payload: unknown): void {
  const wire = tenantKey(channel)
  void getRedis()
    .publish(wire, JSON.stringify(payload))
    .catch((err) => log.warn({ err, channel: wire }, 'publish failed'))
}

/** Drain the subscriber connection on graceful shutdown. */
export async function closeSubscriber(): Promise<void> {
  if (!subscriber) return
  try {
    await subscriber.quit()
  } catch {
    subscriber.disconnect()
  }
  subscriber = null
  listeners.clear()
}
