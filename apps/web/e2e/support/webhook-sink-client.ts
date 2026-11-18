/**
 * Test-side client for the webhook sink (stand-ins/webhook-sink.ts).
 *
 *   const url = sink.url(channel)           // register this as the webhook URL
 *   const [delivery] = await sink.waitForDeliveries(channel)
 *
 * Use a channel name unique to the test; the sink is shared by every worker.
 */
import type { SinkDelivery } from './stand-ins/webhook-sink'
import { pollFor } from './db'
import { supportEnv } from './env'

export type { SinkDelivery }

export const sink = {
  /** The https URL that records deliveries under `channel`. */
  url(channel: string): string {
    return `${supportEnv().sinkOrigin}/hooks/${channel}`
  },

  async deliveries(channel: string): Promise<SinkDelivery[]> {
    const res = await fetch(
      `${supportEnv().sinkControlUrl}/__sink/deliveries?channel=${encodeURIComponent(channel)}`
    )
    if (!res.ok) throw new Error(`sink deliveries failed: ${res.status}`)
    return (await res.json()) as SinkDelivery[]
  },

  /** Wait until `channel` has at least `count` deliveries (optionally matching). */
  async waitForDeliveries(
    channel: string,
    opts: { count?: number; where?: (d: SinkDelivery) => boolean; timeoutMs?: number } = {}
  ): Promise<SinkDelivery[]> {
    const count = opts.count ?? 1
    return pollFor(
      `${count} webhook deliveries on ${channel}`,
      async () => {
        const found = (await sink.deliveries(channel)).filter(opts.where ?? (() => true))
        return found.length >= count ? found : null
      },
      { timeoutMs: opts.timeoutMs ?? 20_000 }
    )
  },

  /** Answer this channel with `status` (null restores 200), for retry tests. */
  async respondWith(channel: string, status: number | null): Promise<void> {
    const res = await fetch(`${supportEnv().sinkControlUrl}/__sink/channels/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(status === null ? {} : { status }),
    })
    if (!res.ok) throw new Error(`sink respondWith failed: ${res.status}`)
  },
}
