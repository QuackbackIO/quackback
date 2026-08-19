/**
 * Tests for import run bookkeeping (§I1): the pending -> running ->
 * completed|failed lifecycle and the batch-tag get-or-create helper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  findFirstImportRuns: vi.fn(),
  findManyImportRuns: vi.fn(),
  findFirstPostTags: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (...args: unknown[]) => {
        hoisted.insertValues(...args)
        return { returning: hoisted.insertReturning }
      },
    }),
    update: (_table: unknown) => ({
      set: (...args: unknown[]) => {
        hoisted.updateSet(...args)
        return { where: hoisted.updateWhere }
      },
    }),
    query: {
      importRuns: {
        findFirst: hoisted.findFirstImportRuns,
        findMany: hoisted.findManyImportRuns,
      },
      postTags: {
        findFirst: hoisted.findFirstPostTags,
      },
    },
  },
  importRuns: { id: 'import_runs.id', createdAt: 'import_runs.created_at' },
  postTags: { id: 'post_tags.id', name: 'post_tags.name' },
  eq: (...args: unknown[]) => ({ eq: args }),
  desc: (...args: unknown[]) => ({ desc: args }),
}))

vi.mock('@quackback/ids', () => ({
  createId: (prefix: string) => `${prefix}_generated`,
}))

import {
  createImportRun,
  markImportRunRunning,
  completeImportRun,
  failImportRun,
  getImportRun,
  listImportRuns,
  buildBatchTagName,
  ensureBatchTag,
} from '../import-run.service'

describe('buildBatchTagName', () => {
  it('formats import-{source}-{yyyy-mm-dd}', () => {
    const date = new Date('2026-07-05T12:34:56Z')
    expect(buildBatchTagName('csv', date)).toBe('import-csv-2026-07-05')
    expect(buildBatchTagName('uservoice', date)).toBe('import-uservoice-2026-07-05')
    expect(buildBatchTagName('canny', date)).toBe('import-canny-2026-07-05')
  })
})

describe('import run CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createImportRun inserts a pending row and returns it', async () => {
    const row = {
      id: 'import_run_generated',
      source: 'csv',
      fileName: 'posts.csv',
      status: 'pending',
    }
    hoisted.insertReturning.mockResolvedValue([row])

    const result = await createImportRun({
      source: 'csv',
      fileName: 'posts.csv',
      initiatedByPrincipalId: 'principal_1' as never,
    })

    expect(hoisted.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'csv', fileName: 'posts.csv', status: 'pending' })
    )
    expect(result).toBe(row)
  })

  it('markImportRunRunning sets status running with the batch tag id', async () => {
    hoisted.updateWhere.mockResolvedValue(undefined)
    await markImportRunRunning('import_run_1' as never, 'post_tag_1' as never)
    expect(hoisted.updateSet).toHaveBeenCalledWith({ status: 'running', batchTagId: 'post_tag_1' })
  })

  it('completeImportRun sets status completed with totals + errors + finishedAt', async () => {
    hoisted.updateWhere.mockResolvedValue(undefined)
    const totals = { rows: 10, created: 8, updated: 0, skipped: 2, errors: 1 }
    await completeImportRun('import_run_1' as never, totals, [{ row: 3, message: 'bad row' }])
    expect(hoisted.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        totals,
        errorReport: [{ row: 3, message: 'bad row' }],
      })
    )
  })

  it('failImportRun sets status failed with a synthetic row-0 error', async () => {
    hoisted.updateWhere.mockResolvedValue(undefined)
    await failImportRun('import_run_1' as never, 'boom')
    expect(hoisted.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorReport: [{ row: 0, message: 'boom' }],
      })
    )
  })

  it('getImportRun returns the row when found', async () => {
    const row = { id: 'import_run_1', status: 'completed' }
    hoisted.findFirstImportRuns.mockResolvedValue(row)
    const result = await getImportRun('import_run_1' as never)
    expect(result).toBe(row)
  })

  it('getImportRun throws NotFoundError when missing', async () => {
    hoisted.findFirstImportRuns.mockResolvedValue(undefined)
    await expect(getImportRun('import_run_missing' as never)).rejects.toThrow(/not found/i)
  })

  it('listImportRuns returns rows newest first', async () => {
    const rows = [{ id: 'import_run_2' }, { id: 'import_run_1' }]
    hoisted.findManyImportRuns.mockResolvedValue(rows)
    const result = await listImportRuns()
    expect(result).toBe(rows)
  })
})

describe('ensureBatchTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reuses an existing tag for the same source + day', async () => {
    hoisted.findFirstPostTags.mockResolvedValue({ id: 'post_tag_existing', name: 'import-csv-x' })
    const result = await ensureBatchTag('csv')
    expect(result.id).toBe('post_tag_existing')
    expect(hoisted.insertValues).not.toHaveBeenCalled()
  })

  it('creates the tag when none exists yet', async () => {
    hoisted.findFirstPostTags.mockResolvedValue(undefined)
    hoisted.insertReturning.mockResolvedValue([])
    const result = await ensureBatchTag('uservoice')
    expect(result.id).toBe('post_tag_generated')
    expect(result.name).toMatch(/^import-uservoice-\d{4}-\d{2}-\d{2}$/)
    expect(hoisted.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'post_tag_generated', color: '#6b7280' })
    )
  })
})
