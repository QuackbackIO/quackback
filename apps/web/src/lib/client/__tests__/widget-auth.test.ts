// @vitest-environment happy-dom
// widget-auth reads window.localStorage / window.location, so this suite needs a
// DOM env even under the root (node-environment) vitest config.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setWidgetToken,
  getWidgetToken,
  clearWidgetToken,
  hasWidgetToken,
  getWidgetAuthHeaders,
  generateOneTimeToken,
  persistAnonymousToken,
  readPersistedToken,
  clearPersistedToken,
} from '../widget-auth'
import { installInMemoryLocalStorage } from '@/test/local-storage'

installInMemoryLocalStorage()

describe('widget-auth', () => {
  beforeEach(() => {
    clearWidgetToken()
    window.localStorage.clear()
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

  describe('anonymous token persistence', () => {
    const KEY = `quackback:anon-token:${window.location.origin}`

    it('round-trips an anonymous token through localStorage', () => {
      expect(getWidgetToken()).toBeNull()
      persistAnonymousToken('anon-token-abc')
      // persistence does not touch the in-memory token — mirrors a fresh load
      // where the module re-initializes empty but localStorage survives.
      expect(getWidgetToken()).toBeNull()
      expect(readPersistedToken()).toBe('anon-token-abc')
    })

    it('namespaces the storage key by origin', () => {
      persistAnonymousToken('tok')
      const raw = window.localStorage.getItem(KEY)
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw!).token).toBe('tok')
    })

    it('returns null when nothing is persisted', () => {
      expect(readPersistedToken()).toBeNull()
    })

    it('drops and ignores an expired token', () => {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ token: 'old', expiresAt: Date.now() - 1000 })
      )
      expect(readPersistedToken()).toBeNull()
      expect(window.localStorage.getItem(KEY)).toBeNull()
    })

    it('drops a malformed (non-JSON) entry', () => {
      window.localStorage.setItem(KEY, 'not-json')
      expect(readPersistedToken()).toBeNull()
      expect(window.localStorage.getItem(KEY)).toBeNull()
    })

    it('drops an entry missing required fields', () => {
      window.localStorage.setItem(KEY, JSON.stringify({ token: 123 }))
      expect(readPersistedToken()).toBeNull()
    })

    it('stores a future expiry hint within ~7 days', () => {
      const before = Date.now()
      persistAnonymousToken('tok')
      const { expiresAt } = JSON.parse(window.localStorage.getItem(KEY)!)
      expect(expiresAt).toBeGreaterThan(before)
      expect(expiresAt).toBeLessThanOrEqual(before + 7 * 24 * 60 * 60 * 1000 + 1000)
    })

    it('clearPersistedToken removes only the persisted copy, not the in-memory token', () => {
      setWidgetToken('in-mem')
      persistAnonymousToken('in-mem')
      clearPersistedToken()
      expect(getWidgetToken()).toBe('in-mem')
      expect(readPersistedToken()).toBeNull()
    })

    it('clearWidgetToken clears both the in-memory and the persisted token', () => {
      setWidgetToken('tok')
      persistAnonymousToken('tok')
      clearWidgetToken()
      expect(getWidgetToken()).toBeNull()
      expect(readPersistedToken()).toBeNull()
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
        credentials: 'omit',
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
