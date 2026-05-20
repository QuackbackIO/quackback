/**
 * `pruneAuditLog` retention sweep.
 *
 * Called once a day from startup.ts (with a 30s post-boot delay) to drop
 * audit_log rows older than `auditLogRetentionDays`. Defaults to 365
 * days (SOC2's one-year minimum). `0` or any non-positive value
 * short-circuits to no-op so operators can keep history forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: { execute: (...a: unknown[]) => mockExecute(...a) },
}))

const { pruneAuditLog, DEFAULT_AUDIT_RETENTION_DAYS } = await import('../log')

beforeEach(() => {
  vi.clearAllMocks()
  mockExecute.mockResolvedValue({ count: 0 })
})

describe('pruneAuditLog', () => {
  it('exposes 365 as the default retention window', () => {
    expect(DEFAULT_AUDIT_RETENTION_DAYS).toBe(365)
  })

  it('runs a DELETE against audit_log when called with no opts', async () => {
    mockExecute.mockResolvedValue({ count: 7 })
    const deleted = await pruneAuditLog()
    expect(deleted).toBe(7)
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('honors a custom retentionDays override', async () => {
    mockExecute.mockResolvedValue({ count: 12 })
    const deleted = await pruneAuditLog({ retentionDays: 30 })
    expect(deleted).toBe(12)
  })

  it('short-circuits to 0 without hitting the DB when retentionDays=0', async () => {
    const deleted = await pruneAuditLog({ retentionDays: 0 })
    expect(deleted).toBe(0)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('short-circuits to 0 when retentionDays is negative', async () => {
    const deleted = await pruneAuditLog({ retentionDays: -1 })
    expect(deleted).toBe(0)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('falls back to result.length when result.count is undefined', async () => {
    mockExecute.mockResolvedValue({ length: 3 })
    const deleted = await pruneAuditLog()
    expect(deleted).toBe(3)
  })

  it('returns 0 when neither count nor length is exposed (defensive)', async () => {
    mockExecute.mockResolvedValue({})
    const deleted = await pruneAuditLog()
    expect(deleted).toBe(0)
  })
})
