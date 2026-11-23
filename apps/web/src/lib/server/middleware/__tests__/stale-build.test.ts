// @vitest-environment node
/**
 * A tab running the build before an update calls server functions by ids the
 * running server does not have. Those calls are answered with the stale-build
 * response (409, marked, never cached) and logged at warn once per id; every
 * other failure passes through untouched.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AppLogger } from '@quackback/logger'
import {
  STALE_BUILD_HEADER,
  STALE_BUILD_MESSAGE,
  STALE_BUILD_STATUS,
} from '@/lib/shared/stale-build'
import { handleStaleBuild, unknownServerFnId } from '../stale-build'

function fakeLog() {
  return { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as AppLogger & {
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  }
}

const lookupFailure = (id: string) => new Error(`Server function info not found for ${id}`)

describe('unknownServerFnId', () => {
  it('reads the id from the lookup failure of a production build', () => {
    expect(unknownServerFnId(lookupFailure('abc123'))).toBe('abc123')
  })

  it('reads the id from the lookup failure of the dev server', () => {
    expect(unknownServerFnId(new Error('Invalid server function ID: abc123'))).toBe('abc123')
  })

  it.each([
    new Error('Server function not accessible from client: abc123'),
    new Error('Server function module not resolved for abc123'),
    new Error('boom'),
    'Server function info not found for abc123',
    null,
  ])('leaves any other failure alone: %s', (error) => {
    expect(unknownServerFnId(error)).toBeNull()
  })
})

describe('handleStaleBuild', () => {
  it('answers an unknown id with a 409 the browser can recognise and no cache may keep', async () => {
    const log = fakeLog()
    const result = await handleStaleBuild({
      handlerType: 'serverFn',
      next: () => Promise.reject(lookupFailure('first-id')),
      log,
    })
    expect(result).toBeInstanceOf(Response)
    const response = result as Response
    expect(response.status).toBe(STALE_BUILD_STATUS)
    expect(response.status).toBe(409)
    expect(response.headers.get(STALE_BUILD_HEADER)).toBe('1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(STALE_BUILD_MESSAGE)
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toEqual({ server_fn_id: 'first-id' })
  })

  it('logs each id once per process, however often a tab polls it', async () => {
    const log = fakeLog()
    for (let i = 0; i < 5; i++) {
      await handleStaleBuild({
        handlerType: 'serverFn',
        next: () => Promise.reject(lookupFailure('polled-id')),
        log,
      })
    }
    await handleStaleBuild({
      handlerType: 'serverFn',
      next: () => Promise.reject(lookupFailure('other-id')),
      log,
    })
    expect(log.warn).toHaveBeenCalledTimes(2)
  })

  it('rethrows every other failure unchanged', async () => {
    const boom = new Error('boom')
    await expect(
      handleStaleBuild({
        handlerType: 'serverFn',
        next: () => Promise.reject(boom),
        log: fakeLog(),
      })
    ).rejects.toBe(boom)
  })

  it('passes a successful call through as it came', async () => {
    const result = { response: new Response('ok') }
    await expect(
      handleStaleBuild({ handlerType: 'serverFn', next: () => Promise.resolve(result) })
    ).resolves.toBe(result)
  })

  it('leaves page and API requests alone', async () => {
    const failure = lookupFailure('not-a-server-fn')
    await expect(
      handleStaleBuild({ handlerType: 'router', next: () => Promise.reject(failure) })
    ).rejects.toBe(failure)
  })
})
