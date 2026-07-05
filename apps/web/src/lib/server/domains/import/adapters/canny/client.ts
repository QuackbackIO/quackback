/**
 * Canny API HTTP client (§I3). Handles auth, v1 skip/limit pagination, rate
 * limiting, and retry with exponential backoff. Ported from
 * `scripts/import/adapters/canny/client.ts`, trimmed to the v1 endpoints the
 * in-app normalizer needs (boards/posts/votes) — no v2 cursor pagination,
 * since comments/changelog aren't part of the wizard's canonical row shape.
 */

const BASE_URL = 'https://canny.io/api'

interface CannyClientOptions {
  apiKey: string
  /** Delay between requests in ms (default: 200) */
  delayMs?: number
}

export class CannyClient {
  private apiKey: string
  private delayMs: number
  private lastRequestAt = 0

  constructor(options: CannyClientOptions) {
    this.apiKey = options.apiKey
    this.delayMs = options.delayMs ?? 200
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    await this.rateLimit()

    const url = `${BASE_URL}${path}`
    const requestBody = { apiKey: this.apiKey, ...body }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** attempt, 10000)
        const jitter = backoff * (0.5 + Math.random())
        await new Promise((r) => setTimeout(r, jitter))
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000
        await new Promise((r) => setTimeout(r, delay))
        lastError = new Error(`Rate limited (429) on ${path}`)
        continue
      }

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Canny API error ${response.status} on ${path}: ${text}`)
      }

      return (await response.json()) as T
    }

    throw lastError ?? new Error(`Failed after 3 attempts: ${path}`)
  }

  /** Paginate a v1 endpoint (skip/limit based). */
  async listAll<T>(
    path: string,
    dataKey: string,
    params: Record<string, unknown> = {},
    limit = 100
  ): Promise<T[]> {
    const items: T[] = []
    let skip = 0

    while (true) {
      const response = await this.post<Record<string, unknown>>(path, { ...params, limit, skip })

      const page = response[dataKey] as T[]
      if (!page || page.length === 0) break

      items.push(...page)
      skip += page.length

      if (!(response.hasMore as boolean)) break
    }

    return items
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestAt
    if (elapsed < this.delayMs) {
      await new Promise((r) => setTimeout(r, this.delayMs - elapsed))
    }
    this.lastRequestAt = Date.now()
  }
}
