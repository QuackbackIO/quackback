/**
 * Quackback API HTTP client for imports
 *
 * Handles authentication, import mode header, rate limiting awareness,
 * and retry with exponential backoff.
 */

interface QuackbackClientOptions {
  baseUrl: string
  apiKey: string
  /** Enable import mode (suppresses side effects, higher rate limit) */
  importMode?: boolean
  /** Delay between requests in ms (default: 30) */
  delayMs?: number
}

interface ApiResponse<T = unknown> {
  data: T
  pagination?: { cursor: string | null; hasMore: boolean }
}

export class QuackbackClient {
  private baseUrl: string
  private apiKey: string
  private importMode: boolean
  private delayMs: number
  private lastRequestAt = 0

  constructor(options: QuackbackClientOptions) {
    // Strip trailing slash
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.importMode = options.importMode ?? true
    this.delayMs = options.delayMs ?? 30
  }

  /**
   * Make a POST request to the Quackback API
   */
  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  /**
   * Make a GET request to the Quackback API
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value)
      }
    }
    return this.request<T>('GET', url.pathname + url.search)
  }

  /**
   * Paginate a GET endpoint, collecting all items
   */
  async listAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const items: T[] = []
    let cursor: string | undefined

    while (true) {
      const queryParams = { ...params, limit: '100' }
      if (cursor) queryParams.cursor = cursor

      const response = await this.get<ApiResponse<T[]>>(path, queryParams)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shape varies by endpoint
      const raw = response as Record<string, any>
      const data = raw.data ?? response
      if (Array.isArray(data)) {
        items.push(...data)
      }

      const pagination = raw.pagination
      if (!pagination?.hasMore || !pagination?.cursor) break
      cursor = pagination.cursor
    }

    return items
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.rateLimit()

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    }
    if (this.importMode) {
      headers['X-Import-Mode'] = 'true'
    }

    let lastError: Error | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** attempt, 30000)
        const jitter = backoff * (0.5 + Math.random())
        await new Promise((r) => setTimeout(r, jitter))
      }

      const response = await fetch(url, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000
        await new Promise((r) => setTimeout(r, delay))
        lastError = new Error(`Rate limited (429) on ${method} ${path}`)
        continue
      }

      if (response.status >= 500) {
        lastError = new Error(`Server error ${response.status} on ${method} ${path}`)
        continue
      }

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Quackback API error ${response.status} on ${method} ${path}: ${text}`)
      }

      return (await response.json()) as T
    }

    throw lastError ?? new Error(`Failed after 5 attempts: ${method} ${path}`)
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
