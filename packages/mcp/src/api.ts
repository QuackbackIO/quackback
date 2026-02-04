/**
 * Thin REST API helper for the Quackback API
 *
 * Features:
 * - Bearer token authentication
 * - Jittered exponential backoff for retries
 * - AbortSignal support for cancellation
 * - Typed error handling
 */

import { ApiError, AuthError } from './errors.js'

export interface ApiConfig {
  url: string
  apiKey: string
}

/**
 * Calculate jittered delay for exponential backoff.
 * Base delay doubles each attempt (1s, 2s, 4s) with 0.5-1.5x jitter
 * to prevent thundering herd.
 */
function jitteredDelay(attempt: number): number {
  const base = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s
  const jitter = 0.5 + Math.random() // 0.5-1.5x
  return Math.floor(base * jitter)
}

/**
 * Make an API request to the Quackback REST API.
 *
 * @param config - API configuration with URL and API key
 * @param path - API path (e.g., '/posts', '/posts/post_xxx')
 * @param options - Fetch options including method, body, signal
 * @returns Parsed JSON response
 * @throws AuthError for 401/403 (should propagate as MCP protocol error)
 * @throws ApiError for other HTTP errors
 */
export async function api<T>(
  config: ApiConfig,
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  const url = `${config.url}/api/v1${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  let lastError: Error | null = null
  const maxRetries = 3

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...options, headers, signal: options.signal })

      // Auth errors should not be retried
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`Authentication failed: ${res.status}`)
      }

      // Retry on rate limit or server errors
      if (res.status === 429 || res.status >= 500) {
        lastError = new ApiError(res.status, `HTTP ${res.status}`)
        const retryAfter = res.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : jitteredDelay(attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      // Handle non-OK responses
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const errorMessage = body.error?.message || body.error || `HTTP ${res.status}`
        throw new ApiError(res.status, errorMessage)
      }

      // Handle 204 No Content
      if (res.status === 204) return undefined as T

      return await res.json()
    } catch (err) {
      // Don't retry auth errors
      if (err instanceof AuthError) throw err
      // Don't retry client errors (4xx)
      if (err instanceof ApiError && err.status < 500) throw err

      lastError = err as Error
    }
  }

  throw lastError || new Error('Request failed after retries')
}
