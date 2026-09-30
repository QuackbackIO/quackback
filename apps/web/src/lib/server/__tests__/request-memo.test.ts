/**
 * The request memo: one computation per key per request, partitioned by
 * workspace, and able to let go of an entry after a write.
 */
import { describe, expect, it, vi } from 'vitest'

let namespace = '_'
vi.mock('@/lib/server/workspaces/workspace-keyed', () => ({
  currentWorkspaceNamespace: () => namespace,
}))

const { runWithLogContext } = await import('@/lib/server/log-context')
const { forgetPerRequest, forgetPerRequestPrefix, memoizePerRequest, rememberPerRequest } =
  await import('../request-memo')

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: crypto.randomUUID() }, fn)
}

function counter() {
  let n = 0
  return {
    next: async () => ++n,
    get count() {
      return n
    },
  }
}

describe('memoizePerRequest', () => {
  it('computes once per request and again in the next one', async () => {
    const c = counter()
    const first = await inRequest(async () => [
      await memoizePerRequest('k', c.next),
      await memoizePerRequest('k', c.next),
    ])
    const second = await inRequest(() => memoizePerRequest('k', c.next))
    expect(first).toEqual([1, 1])
    expect(second).toBe(2)
  })

  it('keeps each workspace apart under one request', async () => {
    const c = counter()
    const values = await inRequest(async () => {
      namespace = 'ws_a'
      const a = await memoizePerRequest('settings', c.next)
      namespace = 'ws_b'
      const b = await memoizePerRequest('settings', c.next)
      namespace = 'ws_a'
      const aAgain = await memoizePerRequest('settings', c.next)
      return [a, b, aAgain]
    })
    namespace = '_'
    expect(values).toEqual([1, 2, 1])
  })

  it('forgets a key, a prefix, or only its own workspace', async () => {
    const c = counter()
    const values = await inRequest(async () => {
      await memoizePerRequest('identity:session', c.next) // 1
      await memoizePerRequest('identity:principal', c.next) // 2
      await memoizePerRequest('other', c.next) // 3
      forgetPerRequest('other')
      const other = await memoizePerRequest('other', c.next) // 4
      forgetPerRequestPrefix('identity:')
      const session = await memoizePerRequest('identity:session', c.next) // 5
      namespace = 'ws_b'
      forgetPerRequest('other')
      namespace = '_'
      const otherAgain = await memoizePerRequest('other', c.next) // still 4
      return [other, session, otherAgain]
    })
    expect(values).toEqual([4, 5, 4])
  })

  it('serves a remembered value without computing', async () => {
    const c = counter()
    const value = await inRequest(async () => {
      rememberPerRequest('k', 42)
      return memoizePerRequest('k', c.next)
    })
    expect(value).toBe(42)
    expect(c.count).toBe(0)
  })

  it('does not keep a failure', async () => {
    let calls = 0
    const flaky = async () => {
      calls += 1
      if (calls === 1) throw new Error('transient')
      return 'ok'
    }
    const outcome = await inRequest(async () => {
      const first = await memoizePerRequest('k', flaky).catch((e: Error) => e.message)
      return [first, await memoizePerRequest('k', flaky)]
    })
    expect(outcome).toEqual(['transient', 'ok'])
  })

  it('computes every time outside a request', async () => {
    const c = counter()
    await memoizePerRequest('k', c.next)
    await memoizePerRequest('k', c.next)
    expect(c.count).toBe(2)
  })
})
