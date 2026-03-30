import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setWidgetToken,
  getWidgetToken,
  clearWidgetToken,
  hasWidgetToken,
  getWidgetAuthHeaders,
  generateOneTimeToken,
} from '../widget-auth'

describe('widget-auth', () => {
  beforeEach(() => {
    clearWidgetToken()
  })

  describe('token management', () => {
    it('starts with no token', () => {
      expect(getWidgetToken()).toBeNull()
      expect(hasWidgetToken()).toBe(false)
    })

    it('stores and retrieves a token', () => {
      setWidgetToken('test-token-123')
      expect(getWidgetToken()).toBe('test-token-123')
      expect(hasWidgetToken()).toBe(true)
    })

    it('clears the token', () => {
      setWidgetToken('test-token-123')
      clearWidgetToken()
      expect(getWidgetToken()).toBeNull()
      expect(hasWidgetToken()).toBe(false)
    })

    it('overwrites existing token', () => {
      setWidgetToken('token-1')
      setWidgetToken('token-2')
      expect(getWidgetToken()).toBe('token-2')
    })
  })

  describe('getWidgetAuthHeaders', () => {
    it('returns empty object when no token', () => {
      expect(getWidgetAuthHeaders()).toEqual({})
    })

    it('returns Authorization Bearer header when token exists', () => {
      setWidgetToken('my-bearer-token')
      expect(getWidgetAuthHeaders()).toEqual({
        Authorization: 'Bearer my-bearer-token',
      })
    })

    it('returns empty object after token is cleared', () => {
      setWidgetToken('my-bearer-token')
      clearWidgetToken()
      expect(getWidgetAuthHeaders()).toEqual({})
    })
  })

  describe('generateOneTimeToken', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('returns null when no token is set', async () => {
      const result = await generateOneTimeToken()
      expect(result).toBeNull()
    })

    it('returns token from successful API call', async () => {
      setWidgetToken('bearer-token')
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'ott-abc123' }),
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await generateOneTimeToken()
      expect(result).toBe('ott-abc123')
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/one-time-token/generate', {
        headers: { Authorization: 'Bearer bearer-token' },
      })
    })

    it('returns null on API error', async () => {
      setWidgetToken('bearer-token')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        })
      )

      const result = await generateOneTimeToken()
      expect(result).toBeNull()
    })

    it('returns null on network failure', async () => {
      setWidgetToken('bearer-token')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

      const result = await generateOneTimeToken()
      expect(result).toBeNull()
    })

    it('returns null when API response has no token field', async () => {
      setWidgetToken('bearer-token')
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({}),
        })
      )

      const result = await generateOneTimeToken()
      expect(result).toBeNull()
    })
  })
})
