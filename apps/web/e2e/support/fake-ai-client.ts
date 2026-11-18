/**
 * Test-side client for the fake AI server (stand-ins/fake-ai.ts).
 *
 *   await fakeAi.script({ marker, json: { spam: true } })
 *   ... make the app call AI with `marker` somewhere in the prompt ...
 *   const [req] = await fakeAi.waitForRequests({ contains: marker })
 *
 * Always script and look up by a marker unique to the test (see `uniqueMarker`
 * in fixtures.ts): the server is shared by every worker.
 */
import type { FakeAiRule, RecordedAiRequest } from './stand-ins/fake-ai'
import { pollFor } from './db'
import { supportEnv } from './env'

export type { FakeAiRule, RecordedAiRequest }

/** Put either marker in a prompt to make the fake fail (500) or stall (120 s). */
export const FAKE_AI_FAIL = '[[fake-ai:fail]]'
export const FAKE_AI_STALL = '[[fake-ai:stall]]'

function url(path: string): string {
  return `${supportEnv().fakeAiUrl}${path}`
}

export const fakeAi = {
  /** Add a rule: requests whose prompt contains `marker` get this answer. */
  async script(rule: FakeAiRule): Promise<void> {
    const res = await fetch(url('/__fake/rules'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rule),
    })
    if (!res.ok) throw new Error(`fake AI script failed: ${res.status} ${await res.text()}`)
  },

  /** Drop every rule for a marker. */
  async clear(marker: string): Promise<void> {
    await fetch(url(`/__fake/rules?marker=${encodeURIComponent(marker)}`), { method: 'DELETE' })
  },

  /** Requests the fake received whose prompt contains `contains`. */
  async requests(
    opts: { contains?: string; endpoint?: 'chat' | 'embeddings' } = {}
  ): Promise<RecordedAiRequest[]> {
    const params = new URLSearchParams()
    if (opts.contains) params.set('contains', opts.contains)
    if (opts.endpoint) params.set('endpoint', opts.endpoint)
    const res = await fetch(url(`/__fake/requests?${params}`))
    if (!res.ok) throw new Error(`fake AI requests failed: ${res.status}`)
    return (await res.json()) as RecordedAiRequest[]
  },

  /** Wait until at least `count` matching requests arrived. */
  async waitForRequests(
    opts: { contains: string; endpoint?: 'chat' | 'embeddings'; count?: number },
    timeoutMs = 15_000
  ): Promise<RecordedAiRequest[]> {
    const count = opts.count ?? 1
    return pollFor(
      `${count} fake AI request(s) containing "${opts.contains}"`,
      async () => {
        const found = await fakeAi.requests(opts)
        return found.length >= count ? found : null
      },
      { timeoutMs }
    )
  },
}
