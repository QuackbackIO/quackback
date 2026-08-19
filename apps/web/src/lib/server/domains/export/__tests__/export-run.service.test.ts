/**
 * Tests for export run bookkeeping: the pending -> running ->
 * completed|failed lifecycle, expiry computation, and the stale/expired
 * sweep helpers the worker's cleanup relies on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  deleteWhere: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: () => ({
      values: (...args: unknown[]) => {
        hoisted.insertValues(...args)
        return { returning: hoisted.insertReturning }
      },
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        hoisted.updateSet(...args)
        return {
          where: (...w: unknown[]) => {
            hoisted.updateWhere(...w)
            return { returning: hoisted.updateReturning }
          },
        }
      },
    }),
    delete: () => ({ where: hoisted.deleteWhere }),
    query: {
      exportRuns: {
        findFirst: hoisted.findFirst,
        findMany: hoisted.findMany,
      },
    },
  },
  exportRuns: { id: 'export_runs.id', createdAt: 'export_runs.created_at', status: 'status' },
  eq: (...args: unknown[]) => ({ eq: args }),
  desc: (...args: unknown[]) => ({ desc: args }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  lt: (...args: unknown[]) => ({ lt: args }),
}))

vi.mock('@quackback/ids', () => ({
  createId: (prefix: string) => `${prefix}_generated`,
}))

import {
  createExportRun,
  getExportRun,
  listExportRuns,
  findActiveExportRun,
  completeExportRun,
  failExportRun,
  failStaleActiveRuns,
  listExpiredCompletedRuns,
  deleteExportRun,
  EXPORT_RETENTION_DAYS,
} from '../export-run.service'
import { NotFoundError } from '@/lib/shared/errors'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createExportRun', () => {
  it('inserts a pending run with the given filename and initiator', async () => {
    hoisted.insertReturning.mockResolvedValue([{ id: 'export_run_generated', status: 'pending' }])
    const run = await createExportRun({
      fileName: 'quackback-export-acme-2026-07-17.zip',
      initiatedByPrincipalId: 'principal_1' as never,
    })
    expect(run.id).toBe('export_run_generated')
    expect(hoisted.insertValues).toHaveBeenCalledWith({
      id: 'export_run_generated',
      fileName: 'quackback-export-acme-2026-07-17.zip',
      initiatedByPrincipalId: 'principal_1',
      status: 'pending',
    })
  })
})

describe('getExportRun', () => {
  it('throws NotFoundError for an unknown run', async () => {
    hoisted.findFirst.mockResolvedValue(undefined)
    await expect(getExportRun('export_run_missing' as never)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('listExportRuns', () => {
  it('caps history at 20 by default', async () => {
    hoisted.findMany.mockResolvedValue([])
    await listExportRuns()
    expect(hoisted.findMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }))
  })
})

describe('findActiveExportRun', () => {
  it('looks for pending/running rows only', async () => {
    hoisted.findFirst.mockResolvedValue(null)
    const active = await findActiveExportRun()
    expect(active).toBeNull()
    const where = hoisted.findFirst.mock.calls[0][0].where
    expect(where.inArray[1]).toEqual(['pending', 'running'])
  })
})

describe('completeExportRun', () => {
  it('writes the artifact fields and sets expires_at retention days out', async () => {
    hoisted.updateWhere.mockReturnValue?.(undefined)
    await completeExportRun('export_run_1' as never, {
      s3Key: 'exports/export_run_1.zip',
      sizeBytes: 1234,
      entityCounts: { posts: 10 },
    })
    const set = hoisted.updateSet.mock.calls[0][0]
    expect(set.status).toBe('completed')
    expect(set.s3Key).toBe('exports/export_run_1.zip')
    expect(set.sizeBytes).toBe(1234)
    expect(set.entityCounts).toEqual({ posts: 10 })
    const expected = set.finishedAt.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000
    expect(Math.abs(set.expiresAt.getTime() - expected)).toBeLessThan(1000)
  })
})

describe('failExportRun', () => {
  it('marks the run failed with the error message', async () => {
    await failExportRun('export_run_1' as never, 'boom')
    const set = hoisted.updateSet.mock.calls[0][0]
    expect(set.status).toBe('failed')
    expect(set.error).toBe('boom')
    expect(set.finishedAt).toBeInstanceOf(Date)
  })
})

describe('failStaleActiveRuns', () => {
  it('fails only active runs older than the stale cutoff', async () => {
    hoisted.updateReturning.mockResolvedValue([{ id: 'export_run_stale' }])
    const failed = await failStaleActiveRuns(new Date('2026-07-17T12:00:00Z'))
    expect(failed).toEqual(['export_run_stale'])
    const set = hoisted.updateSet.mock.calls[0][0]
    expect(set.status).toBe('failed')
    expect(set.error).toMatch(/restarted/)
    // where = and(inArray(status, [pending, running]), lt(createdAt, cutoff))
    const where = hoisted.updateWhere.mock.calls[0][0]
    expect(where.and[0].inArray[1]).toEqual(['pending', 'running'])
    expect(where.and[1].lt[1]).toEqual(new Date('2026-07-17T11:00:00Z'))
  })
})

describe('listExpiredCompletedRuns', () => {
  it('returns completed runs past expiry', async () => {
    hoisted.findMany.mockResolvedValue([{ id: 'export_run_old' }])
    const rows = await listExpiredCompletedRuns(new Date('2026-07-17T12:00:00Z'))
    expect(rows).toHaveLength(1)
  })
})

describe('deleteExportRun', () => {
  it('deletes by id', async () => {
    await deleteExportRun('export_run_1' as never)
    expect(hoisted.deleteWhere).toHaveBeenCalled()
  })
})
