import { describe, it, expect } from 'vitest'
import { isRetryableError } from '../hook-utils'

describe('isRetryableError', () => {
  it('returns false for null/undefined/primitives', () => {
    expect(isRetryableError(null)).toBe(false)
    expect(isRetryableError(undefined)).toBe(false)
    expect(isRetryableError('string')).toBe(false)
    expect(isRetryableError(42)).toBe(false)
  })

  describe('AbortError', () => {
    it('returns true for AbortError (fetch timeout)', () => {
      const error = new DOMException('The operation was aborted', 'AbortError')
      expect(isRetryableError(error)).toBe(true)
    })

    it('returns false for other DOMException types', () => {
      const error = new DOMException('Invalid state', 'InvalidStateError')
      expect(isRetryableError(error)).toBe(false)
    })
  })

  describe('HTTP status codes', () => {
    it('returns true for 429 (rate limit)', () => {
      expect(isRetryableError({ status: 429 })).toBe(true)
    })

    it('returns true for 500+ server errors', () => {
      expect(isRetryableError({ status: 500 })).toBe(true)
      expect(isRetryableError({ status: 502 })).toBe(true)
      expect(isRetryableError({ status: 503 })).toBe(true)
    })

    it('returns false for 4xx client errors (except 429)', () => {
      expect(isRetryableError({ status: 400 })).toBe(false)
      expect(isRetryableError({ status: 401 })).toBe(false)
      expect(isRetryableError({ status: 404 })).toBe(false)
    })

    it('returns false for 200 OK', () => {
      expect(isRetryableError({ status: 200 })).toBe(false)
    })
  })

  describe('error codes', () => {
    it('returns true for ECONNRESET', () => {
      expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true)
    })

    it('returns true for ETIMEDOUT', () => {
      expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true)
    })

    it('returns true for ENOTFOUND', () => {
      expect(isRetryableError({ code: 'ENOTFOUND' })).toBe(true)
    })

    it('returns true for ECONNREFUSED', () => {
      expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true)
    })

    it('returns true for ConnectionRefused (Bun)', () => {
      expect(isRetryableError({ code: 'ConnectionRefused' })).toBe(true)
    })

    it('returns false for TypeError', () => {
      expect(isRetryableError(new TypeError('Cannot read property'))).toBe(false)
    })
  })

  describe('errors with both status and code', () => {
    it('returns true when status is not retryable but code is', () => {
      expect(isRetryableError({ status: 200, code: 'ECONNRESET' })).toBe(true)
    })

    it('returns true when status is retryable', () => {
      expect(isRetryableError({ status: 503, code: 'SOMETHING' })).toBe(true)
    })

    it('returns false when neither is retryable', () => {
      expect(isRetryableError({ status: 400, code: 'INVALID' })).toBe(false)
    })
  })
})
