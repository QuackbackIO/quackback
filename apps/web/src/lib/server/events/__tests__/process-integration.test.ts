/**
 * BullMQ Integration Tests — real Dragonfly, real queue.
 *
 * Requires Dragonfly running at REDIS_URL (default: redis://localhost:6379).
 * Tests the full enqueue → worker pickup → hook execution pipeline.
 *
 * Skipped in CI if Redis is unavailable.
 */

import { describe, it, expect, vi, afterAll } from 'vitest'
import { Queue } from 'bullmq'
import type { PostCreatedEvent } from '../types'

// ---------------------------------------------------------------------------
// Mocks — we mock targets & registry so we control WHAT runs, while BullMQ
// and Dragonfly are real.
// ---------------------------------------------------------------------------

const mockGetHookTargets = vi.fn()
vi.mock('../targets', () => ({
  getHookTargets: (...args: unknown[]) => mockGetHookTargets(...args),
}))

const mockHookRun = vi.fn()
const mockGetHook = vi.fn()
vi.mock('../registry', () => ({
  getHook: (...args: unknown[]) => mockGetHook(...args),
}))

vi.mock('@/lib/server/config', () => ({
  config: { redisUrl: process.env.REDIS_URL || 'redis://localhost:6379' },
}))

// Stub db import so updateWebhookFailureCount doesn't crash
vi.mock('@/lib/server/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  },
  webhooks: {
    id: 'id',
    failureCount: 'failureCount',
    status: 'status',
    lastTriggeredAt: 'lastTriggeredAt',
    lastError: 'lastError',
  },
  eq: vi.fn(),
  sql: vi.fn(),
}))

// Passthrough mock — ensures Vitest resolves hook-utils through its mock
// system, which is required for consistent module graph resolution when
// other imports from process.ts are mocked.
vi.mock('../hook-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual }
})

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { processEvent, closeQueue } from '../process'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

async function isRedisAvailable(): Promise<boolean> {
  let q: Queue | undefined
  try {
    q = new Queue('{__health-check__}', {
      connection: { url: REDIS_URL, maxRetriesPerRequest: null as null },
    })
    await q.getJobCounts()
    return true
  } catch (err) {
    console.error('[Integration] Redis check failed:', err)
    return false
  } finally {
    await q?.close().catch(() => {})
  }
}

function makeEvent(overrides: Partial<PostCreatedEvent> = {}): PostCreatedEvent {
  return {
    id: `evt-integ-${Date.now()}`,
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', userId: 'user_1', email: 'test@test.com' },
    data: {
      post: {
        id: 'post_1',
        title: 'Integration Test Post',
        content: 'Testing BullMQ pipeline',
        boardId: 'board_1',
        boardSlug: 'bugs',
        voteCount: 0,
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BullMQ Integration (real Dragonfly)', async () => {
  const available = await isRedisAvailable()

  // Skip entire suite if Redis isn't reachable
  if (!available) {
    it.skip('Dragonfly not available — skipping integration tests', () => {})
    return
  }

  afterAll(async () => {
    await closeQueue()
  })

  it('enqueues and processes a job through the real queue', async () => {
    // Track when the hook is called
    const hookCalled = new Promise<{ event: unknown; target: unknown; config: unknown }>(
      (resolve) => {
        mockHookRun.mockImplementation((event: unknown, target: unknown, config: unknown) => {
          resolve({ event, target, config })
          return Promise.resolve({ success: true })
        })
      }
    )

    // Register the mock hook
    mockGetHook.mockReturnValue({ run: mockHookRun })

    // Return a single target
    const event = makeEvent()
    mockGetHookTargets.mockResolvedValue([
      { type: 'test-hook', target: { channel: 'C123' }, config: { token: 'tok' } },
    ])

    // Enqueue
    await processEvent(event)

    // Wait for the worker to pick it up and call our hook (timeout 5s)
    const result = await Promise.race([
      hookCalled,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: hook not called within 5s')), 5000)
      ),
    ])

    // Verify the hook was called with the right data
    expect(result).toBeDefined()
    const {
      event: receivedEvent,
      target,
      config,
    } = result as {
      event: PostCreatedEvent
      target: { channel: string }
      config: { token: string }
    }
    expect(receivedEvent.id).toBe(event.id)
    expect(receivedEvent.type).toBe('post.created')
    expect(target.channel).toBe('C123')
    expect(config.token).toBe('tok')
  })

  it('processes multiple targets from a single event', async () => {
    let callCount = 0
    const allCalled = new Promise<void>((resolve) => {
      mockHookRun.mockImplementation(() => {
        callCount++
        if (callCount >= 3) resolve()
        return Promise.resolve({ success: true })
      })
    })

    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-multi-${Date.now()}` })
    mockGetHookTargets.mockResolvedValue([
      { type: 'test-hook', target: { channel: 'C1' }, config: {} },
      { type: 'test-hook', target: { channel: 'C2' }, config: {} },
      { type: 'test-hook', target: { channel: 'C3' }, config: {} },
    ])

    await processEvent(event)

    await Promise.race([
      allCalled,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: not all hooks called within 5s')), 5000)
      ),
    ])

    expect(callCount).toBe(3)
  })

  it('retries on retryable failure then succeeds', async () => {
    let attempts = 0
    const completed = new Promise<void>((resolve) => {
      mockHookRun.mockImplementation(() => {
        attempts++
        if (attempts < 3) {
          // Return retryable failure
          return Promise.resolve({
            success: false,
            shouldRetry: true,
            error: `Attempt ${attempts} failed`,
          })
        }
        // Succeed on 3rd attempt
        resolve()
        return Promise.resolve({ success: true })
      })
    })

    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-retry-${Date.now()}` })
    mockGetHookTargets.mockResolvedValue([{ type: 'test-hook', target: {}, config: {} }])

    await processEvent(event)

    // BullMQ retries with exponential backoff (1s, 2s) — total up to ~4s
    await Promise.race([
      completed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout: retries not completed within 10s')), 10000)
      ),
    ])

    expect(attempts).toBe(3)
  }, 15000) // 15s timeout for this test

  it('permanently fails on non-retryable error (no retries)', async () => {
    // Non-retryable failures throw UnrecoverableError which BullMQ does NOT retry.
    // We verify the hook is only called once (no retries).
    let callCount = 0
    const hookCalled = new Promise<void>((resolve) => {
      mockHookRun.mockImplementation(() => {
        callCount++
        resolve()
        return Promise.resolve({ success: false, shouldRetry: false, error: 'Bad request' })
      })
    })

    mockGetHook.mockReturnValue({ run: mockHookRun })

    const event = makeEvent({ id: `evt-perm-fail-${Date.now()}` })
    mockGetHookTargets.mockResolvedValue([{ type: 'test-hook', target: {}, config: {} }])

    await processEvent(event)

    // Wait for the hook to be called
    await Promise.race([
      hookCalled,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ])

    // Give BullMQ a moment to NOT retry (if it was going to)
    await new Promise((r) => setTimeout(r, 2000))

    // Should only be called once — UnrecoverableError prevents retries
    expect(callCount).toBe(1)
  }, 10000)
})
