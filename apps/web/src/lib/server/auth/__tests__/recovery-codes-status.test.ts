import { describe, it, expect, vi, beforeEach } from 'vitest'

const where = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: { select: () => ({ from: () => ({ where }) }) },
  ssoRecoveryCode: { id: 'mock_id_col', usedAt: 'mock_usedAt_col' },
  isNull: vi.fn((col) => ({ _kind: 'isNull', col })),
}))

import { hasActiveRecoveryCodes } from '../recovery-codes-status'

beforeEach(() => where.mockReset())

describe('hasActiveRecoveryCodes', () => {
  it('is true when at least one unused code exists', async () => {
    where.mockResolvedValue([{ id: 'rc_1' }])
    expect(await hasActiveRecoveryCodes()).toBe(true)
  })
  it('is false when none exist', async () => {
    where.mockResolvedValue([])
    expect(await hasActiveRecoveryCodes()).toBe(false)
  })
})
