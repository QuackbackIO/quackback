import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNEXPECTED_ERROR_MESSAGE } from '@/lib/shared/error-reference'
import { describeError } from '@/lib/shared/describe-error'
import { STALE_BUILD_HEADER, STALE_BUILD_MESSAGE } from '@/lib/shared/stale-build'
import { serverFnFetch } from '../server-fn-fetch'

function answer(response: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

afterEach(() => vi.unstubAllGlobals())

describe('serverFnFetch', () => {
  it('fails a call the server failed before reaching the function', async () => {
    // What a production build answers for a failure outside any function.
    answer(json({ status: 500, unhandled: true, message: 'HTTPError' }, 500))
    const error = await serverFnFetch('/_serverFn/removed').then(
      () => null,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(UNEXPECTED_ERROR_MESSAGE)
    expect(describeError(error, "Couldn't create roadmap", { team: true, online: true })).toEqual({
      title: "Couldn't create roadmap",
      description: UNEXPECTED_ERROR_MESSAGE,
    })
  })

  it('fails a call a proxy answered while the app was restarting', async () => {
    answer(json({ message: 'Bad Gateway' }, 502))
    await expect(serverFnFetch('/_serverFn/x')).rejects.toThrow(UNEXPECTED_ERROR_MESSAGE)
  })

  it('passes on an error the function itself threw', async () => {
    const thrown = json({ t: 'error' }, 500, { 'x-tss-serialized': 'true' })
    answer(thrown)
    await expect(serverFnFetch('/_serverFn/x')).resolves.toBe(thrown)
  })

  it('passes on a raw response the function returned', async () => {
    const raw = json({ error: 'upstream' }, 503, { 'x-tss-raw': 'true' })
    answer(raw)
    await expect(serverFnFetch('/_serverFn/x')).resolves.toBe(raw)
  })

  it('passes on results and refusals below 500', async () => {
    for (const status of [200, 403, 404, 405]) {
      const response = json({ ok: status === 200 }, status)
      answer(response)
      await expect(serverFnFetch('/_serverFn/x')).resolves.toBe(response)
    }
  })

  it('sends the request it was given', async () => {
    answer(json({}, 200))
    const init = { method: 'POST', body: '{}' }
    await serverFnFetch('/_serverFn/x', init)
    expect(fetch).toHaveBeenCalledWith('/_serverFn/x', init)
  })
})

describe('serverFnFetch on a call from an older build', () => {
  const reload = vi.fn()
  const stale = () =>
    new Response(STALE_BUILD_MESSAGE, {
      status: 409,
      headers: { 'content-type': 'text/plain', [STALE_BUILD_HEADER]: '1' },
    })

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockReset()
    vi.stubGlobal('location', { ...window.location, reload })
  })

  it('reloads the page once and fails the call', async () => {
    answer(stale())
    await expect(serverFnFetch('/_serverFn/old')).rejects.toThrow(STALE_BUILD_MESSAGE)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads once when several calls fail together', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => stale())
    )
    const calls = [1, 2, 3].map(() => serverFnFetch('/_serverFn/old').catch((e: unknown) => e))
    for (const error of await Promise.all(calls)) {
      expect((error as Error).message).toBe(STALE_BUILD_MESSAGE)
    }
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again right after a reload, and shows the error instead', async () => {
    answer(stale())
    await serverFnFetch('/_serverFn/old').catch(() => {})
    // The page after the reload still gets the stale answer.
    answer(stale())
    const error = await serverFnFetch('/_serverFn/old').then(
      () => null,
      (e: unknown) => e
    )
    expect(reload).toHaveBeenCalledTimes(1)
    expect(describeError(error, "Couldn't load inbox", { team: true, online: true })).toEqual({
      title: 'Quackback was updated',
      description: 'Reload to keep working.',
      action: 'reload',
    })
  })

  it('reloads again for a later update', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    answer(stale())
    await serverFnFetch('/_serverFn/old').catch(() => {})
    now.mockReturnValue(1_000_000 + 60 * 60 * 1000)
    answer(stale())
    await serverFnFetch('/_serverFn/older').catch(() => {})
    expect(reload).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('does not reload when the tab cannot remember that it did', async () => {
    const blocked = () => {
      throw new Error('storage disabled')
    }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked })
    answer(stale())
    await expect(serverFnFetch('/_serverFn/old')).rejects.toThrow(STALE_BUILD_MESSAGE)
    expect(reload).not.toHaveBeenCalled()
  })

  it('passes on a 409 the function itself answered', async () => {
    const conflict = json({ ok: false }, 409)
    answer(conflict)
    await expect(serverFnFetch('/_serverFn/x')).resolves.toBe(conflict)
    expect(reload).not.toHaveBeenCalled()
  })
})
