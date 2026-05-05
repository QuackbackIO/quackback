import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: { execute: (...a: unknown[]) => hoisted.mockExecute(...a) },
}))

import { aiTokensThisMonth } from '../usage-counter'

describe('aiTokensThisMonth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 0 when no rows', async () => {
    hoisted.mockExecute.mockResolvedValue([])
    expect(await aiTokensThisMonth()).toBe(0)
  })

  it('returns the numeric sum from the first row', async () => {
    hoisted.mockExecute.mockResolvedValue([{ total: 12345 }])
    expect(await aiTokensThisMonth()).toBe(12345)
  })

  it('coerces the bigint string return shape from postgres', async () => {
    // postgres-js serialises BIGINT as a string
    hoisted.mockExecute.mockResolvedValue([{ total: '987654321' }])
    expect(await aiTokensThisMonth()).toBe(987654321)
  })

  it('issues a SUM query filtering chat_completion + success in the current month', async () => {
    hoisted.mockExecute.mockResolvedValue([{ total: 0 }])
    await aiTokensThisMonth()
    const sqlArg = hoisted.mockExecute.mock.calls[0]?.[0]
    const text = JSON.stringify(sqlArg)
    expect(text).toContain('chat_completion')
    expect(text).toContain('success')
    expect(text).toContain('date_trunc')
    expect(text).toContain('total_tokens')
  })
})
