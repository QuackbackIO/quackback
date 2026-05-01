import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { execute: (...a: unknown[]) => hoisted.mockExecute(...a) },
}))

import { aiOpsThisMonth } from '../usage-counter'

describe('aiOpsThisMonth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when no rows', async () => {
    hoisted.mockExecute.mockResolvedValue([])
    expect(await aiOpsThisMonth()).toBe(0)
  })

  it('returns the integer count from the first row', async () => {
    hoisted.mockExecute.mockResolvedValue([{ count: 42 }])
    expect(await aiOpsThisMonth()).toBe(42)
  })

  it('issues a SQL query that filters chat_completion + success and date_trunc(month)', async () => {
    hoisted.mockExecute.mockResolvedValue([{ count: 0 }])
    await aiOpsThisMonth()
    const sqlArg = hoisted.mockExecute.mock.calls[0]?.[0]
    // The drizzle SQL fragment contains the relevant tokens.
    const text = JSON.stringify(sqlArg)
    expect(text).toContain('chat_completion')
    expect(text).toContain('success')
    expect(text).toContain('date_trunc')
  })
})
