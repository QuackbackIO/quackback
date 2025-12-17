/**
 * IntegrationState Durable Object for state management.
 *
 * Provides strong consistency for:
 * - Circuit breaker state per integration
 * - Idempotency tracking (processed events)
 * - Generic caching
 *
 * Each integration gets its own DO instance, keyed by integration ID.
 */

import { DurableObject } from 'cloudflare:workers'
import { CIRCUIT_BREAKER_CONFIG, IDEMPOTENCY_CONFIG } from '../types'

// Environment type for the Durable Object
interface Env {
  INTEGRATION_STATE: DurableObjectNamespace
}

/**
 * Circuit breaker state stored in the DO.
 */
interface CircuitState {
  state: 'closed' | 'open' | 'half-open'
  failures: number
  lastFailure: number
  lastSuccess: number
}

/**
 * Processed event record for idempotency.
 */
interface ProcessedEvent {
  externalId?: string
  timestamp: number
}

/**
 * Cache entry with optional expiration.
 */
interface CacheEntry {
  value: string
  expiresAt?: number
}

/**
 * Durable Object for managing integration state.
 *
 * Routes:
 * - GET /can-execute - Check if circuit allows execution
 * - POST /record-success - Record successful operation
 * - POST /record-failure - Record failed operation
 * - GET /is-processed/:eventId - Check if event was processed
 * - POST /mark-processed/:eventId - Mark event as processed
 * - GET /processed-result/:eventId - Get processed event result
 * - GET /cache/:key - Get cached value
 * - PUT /cache/:key - Set cached value
 * - DELETE /cache/:key - Delete cached value
 */
export class IntegrationStateDO extends DurableObject<Env> {
  // In-memory state (persisted via storage API)
  private circuitState: CircuitState = {
    state: 'closed',
    failures: 0,
    lastFailure: 0,
    lastSuccess: 0,
  }
  private processedEvents: Map<string, ProcessedEvent> = new Map()
  private cache: Map<string, CacheEntry> = new Map()

  /**
   * Constructor - required by Cloudflare Durable Objects.
   * Uses blockConcurrencyWhile to ensure initialization completes before any requests.
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Use blockConcurrencyWhile to ensure state is loaded before any fetch() calls
    this.ctx.blockConcurrencyWhile(async () => {
      await this.init()
    })
  }

  /**
   * Initialize state from durable storage.
   */
  private async init() {
    // Load circuit state
    const storedCircuit = await this.ctx.storage.get<CircuitState>('circuit')
    if (storedCircuit) {
      this.circuitState = storedCircuit
    }

    // Load processed events
    const storedEvents = await this.ctx.storage.get<Record<string, ProcessedEvent>>('events')
    if (storedEvents) {
      this.processedEvents = new Map(Object.entries(storedEvents))
    }

    // Load cache
    const storedCache = await this.ctx.storage.get<Record<string, CacheEntry>>('cache')
    if (storedCache) {
      this.cache = new Map(Object.entries(storedCache))
    }
  }

  /**
   * Persist circuit state to storage.
   */
  private async persistCircuitState() {
    await this.ctx.storage.put('circuit', this.circuitState)
  }

  /**
   * Persist processed events to storage.
   */
  private async persistEvents() {
    await this.ctx.storage.put('events', Object.fromEntries(this.processedEvents))
  }

  /**
   * Persist cache to storage.
   */
  private async persistCache() {
    await this.ctx.storage.put('cache', Object.fromEntries(this.cache))
  }

  /**
   * Clean up expired entries periodically.
   */
  private async cleanupExpired() {
    const now = Date.now()

    // Clean up old processed events (older than TTL)
    const eventTtlMs = IDEMPOTENCY_CONFIG.ttl * 1000
    let eventsChanged = false
    for (const [eventId, event] of this.processedEvents) {
      if (now - event.timestamp > eventTtlMs) {
        this.processedEvents.delete(eventId)
        eventsChanged = true
      }
    }
    if (eventsChanged) {
      await this.persistEvents()
    }

    // Clean up expired cache entries
    let cacheChanged = false
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key)
        cacheChanged = true
      }
    }
    if (cacheChanged) {
      await this.persistCache()
    }
  }

  /**
   * Handle incoming requests to the DO.
   * Note: State is already initialized via blockConcurrencyWhile in constructor.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Circuit breaker routes
      if (path === '/can-execute' && request.method === 'GET') {
        return this.handleCanExecute()
      }
      if (path === '/record-success' && request.method === 'POST') {
        return this.handleRecordSuccess()
      }
      if (path === '/record-failure' && request.method === 'POST') {
        return this.handleRecordFailure()
      }

      // Idempotency routes
      const isProcessedMatch = path.match(/^\/is-processed\/(.+)$/)
      if (isProcessedMatch && request.method === 'GET') {
        return this.handleIsProcessed(decodeURIComponent(isProcessedMatch[1]))
      }

      const markProcessedMatch = path.match(/^\/mark-processed\/(.+)$/)
      if (markProcessedMatch && request.method === 'POST') {
        const body = await request.json<{ externalId?: string }>()
        return this.handleMarkProcessed(decodeURIComponent(markProcessedMatch[1]), body.externalId)
      }

      const processedResultMatch = path.match(/^\/processed-result\/(.+)$/)
      if (processedResultMatch && request.method === 'GET') {
        return this.handleGetProcessedResult(decodeURIComponent(processedResultMatch[1]))
      }

      // Cache routes
      const cacheMatch = path.match(/^\/cache\/(.+)$/)
      if (cacheMatch) {
        const key = decodeURIComponent(cacheMatch[1])
        if (request.method === 'GET') {
          return this.handleCacheGet(key)
        }
        if (request.method === 'PUT') {
          const body = await request.json<{ value: string; ttl?: number }>()
          return this.handleCacheSet(key, body.value, body.ttl)
        }
        if (request.method === 'DELETE') {
          return this.handleCacheDelete(key)
        }
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      console.error('[IntegrationStateDO] Error:', error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // Circuit breaker handlers

  private async handleCanExecute(): Promise<Response> {
    const { state, lastFailure } = this.circuitState

    if (state === 'closed') {
      return Response.json(true)
    }

    if (state === 'open') {
      // Check if reset timeout has passed
      if (Date.now() - lastFailure > CIRCUIT_BREAKER_CONFIG.resetTimeout) {
        this.circuitState.state = 'half-open'
        await this.persistCircuitState()
        return Response.json(true) // Allow one request through
      }
      return Response.json(false)
    }

    // half-open: allow request
    return Response.json(true)
  }

  private async handleRecordSuccess(): Promise<Response> {
    this.circuitState = {
      state: 'closed',
      failures: 0,
      lastFailure: 0,
      lastSuccess: Date.now(),
    }
    await this.persistCircuitState()
    return Response.json({ ok: true })
  }

  private async handleRecordFailure(): Promise<Response> {
    const newFailures = this.circuitState.failures + 1
    this.circuitState = {
      ...this.circuitState,
      failures: newFailures,
      lastFailure: Date.now(),
      state:
        newFailures >= CIRCUIT_BREAKER_CONFIG.failureThreshold ? 'open' : this.circuitState.state,
    }
    await this.persistCircuitState()
    return Response.json({ ok: true })
  }

  // Idempotency handlers

  private async handleIsProcessed(eventId: string): Promise<Response> {
    // Clean up expired entries occasionally
    if (Math.random() < 0.1) {
      await this.cleanupExpired()
    }

    const event = this.processedEvents.get(eventId)
    return Response.json(event !== undefined)
  }

  private async handleMarkProcessed(eventId: string, externalId?: string): Promise<Response> {
    this.processedEvents.set(eventId, {
      externalId,
      timestamp: Date.now(),
    })
    await this.persistEvents()
    return Response.json({ ok: true })
  }

  private async handleGetProcessedResult(eventId: string): Promise<Response> {
    const event = this.processedEvents.get(eventId)
    return Response.json({ externalId: event?.externalId || null })
  }

  // Cache handlers

  private async handleCacheGet(key: string): Promise<Response> {
    const entry = this.cache.get(key)
    if (!entry) {
      return new Response(null, { status: 404 })
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      await this.persistCache()
      return new Response(null, { status: 404 })
    }
    return new Response(entry.value)
  }

  private async handleCacheSet(key: string, value: string, ttlSeconds?: number): Promise<Response> {
    this.cache.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    })
    await this.persistCache()
    return Response.json({ ok: true })
  }

  private async handleCacheDelete(key: string): Promise<Response> {
    this.cache.delete(key)
    await this.persistCache()
    return Response.json({ ok: true })
  }
}
