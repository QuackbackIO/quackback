// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Memo = typeof import('../route-context-memo')
let memo: Memo
let middleware: typeof import('../route-context-middleware')

beforeEach(async () => {
  // Each test starts from a freshly loaded page: no kept answer, nothing expired.
  vi.resetModules()
  memo = await import('../route-context-memo')
  middleware = await import('../route-context-middleware')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createRouteContextMemo', () => {
  it('shares one call between a preload, the focus preload and the navigation', async () => {
    const context = memo.createRouteContextMemo<{ user: string }>()
    const call = deferred<{ user: string }>()
    const load = vi.fn(() => call.promise)

    const hover = context.get(load)
    const focus = context.get(load)
    call.resolve({ user: 'ada' })
    const navigation = context.get(load)

    expect(load).toHaveBeenCalledTimes(1)
    expect(await hover).toEqual({ user: 'ada' })
    expect(await focus).toEqual({ user: 'ada' })
    expect(await navigation).toEqual({ user: 'ada' })
  })

  it('asks again once the context is expired, e.g. after sign-out invalidates the router', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValueOnce('signed in').mockResolvedValueOnce('signed out')

    expect(await context.get(load)).toBe('signed in')
    memo.expireRouteContext()
    expect(await context.get(load)).toBe('signed out')
    expect(await context.get(load)).toBe('signed out')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not hand a call made before the expiry to a caller after it', async () => {
    const context = memo.createRouteContextMemo<string>()
    const before = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(before.promise).mockResolvedValueOnce('after')

    const stale = context.get(load)
    memo.expireRouteContext()
    const fresh = context.get(load)
    before.resolve('before')

    expect(await stale).toBe('before')
    expect(await fresh).toBe('after')
    expect(await context.get(load)).toBe('after')
  })

  it('asks again after the maximum age', async () => {
    vi.useFakeTimers()
    const context = memo.createRouteContextMemo<number>()
    let n = 0
    const load = vi.fn(async () => ++n)

    expect(await context.get(load)).toBe(1)
    vi.advanceTimersByTime(memo.ROUTE_CONTEXT_MAX_AGE_MS - 1)
    expect(await context.get(load)).toBe(1)
    vi.advanceTimersByTime(1)
    expect(await context.get(load)).toBe(2)
  })

  it('does not keep a failed call', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('recovered')

    await expect(context.get(load)).rejects.toThrow('network')
    expect(await context.get(load)).toBe('recovered')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps nothing on the server, where module state is shared by every request', async () => {
    vi.stubGlobal('window', undefined)
    const context = memo.createRouteContextMemo<string>()
    const load = vi
      .fn()
      .mockResolvedValueOnce('first viewer')
      .mockResolvedValueOnce('second viewer')

    context.seed('rendered viewer')
    expect(await context.get(load)).toBe('first viewer')
    expect(await context.get(load)).toBe('second viewer')
  })

  it('expires when the page comes back into view', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after')

    expect(await context.get(load)).toBe('before')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await context.get(load)).toBe('after')
  })
})

describe('parts of a new answer', () => {
  type Context = { settings: { name: string }; session: { user: string }; flags: string[] }

  it("are the previous answer's where they did not change", async () => {
    const context = memo.createRouteContextMemo<Context>()
    const first = await context.get(async () => ({
      settings: { name: 'Acme' },
      session: { user: 'ada' },
      flags: ['a', 'b'],
    }))
    memo.expireRouteContext()
    const second = await context.get(async () => ({
      settings: { name: 'Acme' },
      session: { user: 'bob' },
      flags: ['a', 'b'],
    }))

    expect(second.settings).toBe(first.settings)
    expect(second.flags).toBe(first.flags)
    expect(second.session).not.toBe(first.session)
    expect(second.session).toEqual({ user: 'bob' })
  })

  it("are the rendered answer's where the first fetch after it did not change them", async () => {
    const context = memo.createRouteContextMemo<Context>()
    const rendered = { settings: { name: 'Acme' }, session: { user: 'ada' }, flags: ['a'] }
    context.seed(rendered)
    memo.expireRouteContext()

    const fetched = await context.get(async () => ({
      settings: { name: 'Acme' },
      session: { user: 'ada' },
      flags: ['a', 'c'],
    }))

    expect(fetched.settings).toBe(rendered.settings)
    expect(fetched.session).toBe(rendered.session)
    expect(fetched.flags).toEqual(['a', 'c'])
  })
})

describe('seed', () => {
  it('serves the server-rendered context to the first navigation', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValue('fetched')

    context.seed('rendered')

    expect(await context.get(load)).toBe('rendered')
    expect(load).not.toHaveBeenCalled()
  })

  it('takes effect once per page, never after an expiry', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValue('fetched')

    context.seed('rendered')
    memo.expireRouteContext()
    // A later render of the page must not put the old context back.
    context.seed('rendered')

    expect(await context.get(load)).toBe('fetched')
  })

  it('is ignored once the context has been fetched or expired', async () => {
    const fetchedFirst = memo.createRouteContextMemo<string>()
    await fetchedFirst.get(async () => 'fetched')
    fetchedFirst.seed('rendered')
    expect(await fetchedFirst.get(async () => 'again')).toBe('fetched')

    memo.expireRouteContext()
    const expiredFirst = memo.createRouteContextMemo<string>()
    expiredFirst.seed('rendered')
    expect(await expiredFirst.get(async () => 'fetched')).toBe('fetched')
  })
})

describe('expiry sources', () => {
  it('expires on router.invalidate(), before the reload it starts', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after')
    await context.get(load)

    let seenByReload: string | undefined
    const router = {
      invalidate: vi.fn(async (_opts?: { sync?: boolean }) => {
        seenByReload = await context.get(load)
      }),
    }
    const original = router.invalidate
    memo.expireRouteContextOnInvalidate(router)

    await router.invalidate({ sync: true })

    expect(original).toHaveBeenCalledWith({ sync: true })
    expect(seenByReload).toBe('after')
  })

  it('expires after a server function called with POST settles, not after a GET', async () => {
    const context = memo.createRouteContextMemo<string>()
    const load = vi.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after')
    await context.get(load)
    const client = middleware.expireRouteContextOnWrite.options.client as unknown as (opts: {
      method: 'GET' | 'POST'
      next: () => Promise<unknown>
    }) => Promise<unknown>

    await client({ method: 'GET', next: async () => ({ result: 'read' }) })
    expect(await context.get(load)).toBe('before')

    await expect(
      client({
        method: 'POST',
        next: async () => {
          throw new Error('the write failed part-way')
        },
      })
    ).rejects.toThrow()
    expect(await context.get(load)).toBe('after')
  })
})
