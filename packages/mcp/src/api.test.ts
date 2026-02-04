import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, type ApiConfig } from './api.js'
import { ApiError, AuthError } from './errors.js'

const mockConfig: ApiConfig = {
  url: 'https://example.com',
  apiKey: 'test_api_key',
}

describe('api', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: 'test' }))))
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should make a GET request with correct headers', async () => {
    const result = await api<{ data: string }>(mockConfig, '/test')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://example.com/api/v1/test')
    // GET method may be omitted from fetch options (it's the default)
    expect(options.headers).toEqual({
      Authorization: 'Bearer test_api_key',
      'Content-Type': 'application/json',
    })
    expect(result).toEqual({ data: 'test' })
  })

  it('should make a POST request with body', async () => {
    await api(mockConfig, '/test', {
      method: 'POST',
      body: JSON.stringify({ foo: 'bar' }),
    })

    const [, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(options.method).toBe('POST')
    expect(options.body).toBe('{"foo":"bar"}')
  })

  it('should throw AuthError on 401', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 })))

    await expect(api(mockConfig, '/test')).rejects.toThrow(AuthError)
  })

  it('should throw AuthError on 403', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response('Forbidden', { status: 403 })))

    await expect(api(mockConfig, '/test')).rejects.toThrow(AuthError)
  })

  it('should throw ApiError on non-2xx response', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 404 }))
    )

    try {
      await api(mockConfig, '/test')
      expect(true).toBe(false) // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(404)
    }
  })

  it('should retry on network errors', async () => {
    let callCount = 0
    globalThis.fetch = vi.fn(() => {
      callCount++
      if (callCount < 2) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve(new Response(JSON.stringify({ data: 'success' })))
    })

    const result = await api<{ data: string }>(mockConfig, '/test')
    expect(result).toEqual({ data: 'success' })
    expect(callCount).toBe(2)
  })
})
