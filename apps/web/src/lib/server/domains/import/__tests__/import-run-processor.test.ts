/**
 * Tests for the async import commit job orchestration (§I1): the run's
 * running -> completed|failed transition around the existing CSV pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  ensureBatchTag: vi.fn(),
  markImportRunRunning: vi.fn(),
  completeImportRun: vi.fn(),
  failImportRun: vi.fn(),
  processImport: vi.fn(),
}))

vi.mock('../import-run.service', () => ({
  ensureBatchTag: hoisted.ensureBatchTag,
  markImportRunRunning: hoisted.markImportRunRunning,
  completeImportRun: hoisted.completeImportRun,
  failImportRun: hoisted.failImportRun,
}))

vi.mock('../import-service', () => ({
  processImport: hoisted.processImport,
}))

import { runImportCommitJob } from '../import-run-processor'

const BASE_INPUT = {
  boardId: 'board_1' as never,
  csvContent: 'base64content',
  totalRows: 5,
  initiatedByPrincipalId: 'principal_1' as never,
}

describe('runImportCommitJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.ensureBatchTag.mockResolvedValue({ id: 'post_tag_1', name: 'import-csv-2026-07-05' })
    hoisted.markImportRunRunning.mockResolvedValue(undefined)
    hoisted.completeImportRun.mockResolvedValue(undefined)
    hoisted.failImportRun.mockResolvedValue(undefined)
  })

  it('creates the batch tag, marks the run running, then completes it with totals', async () => {
    hoisted.processImport.mockResolvedValue({
      imported: 4,
      updated: 0,
      skipped: 1,
      errors: [{ row: 3, message: 'bad row' }],
      createdTags: [],
    })

    await runImportCommitJob({ runId: 'import_run_1' as never, source: 'csv', input: BASE_INPUT })

    expect(hoisted.ensureBatchTag).toHaveBeenCalledWith('csv')
    expect(hoisted.markImportRunRunning).toHaveBeenCalledWith('import_run_1', 'post_tag_1')
    expect(hoisted.processImport).toHaveBeenCalledWith(
      expect.objectContaining({ ...BASE_INPUT, batchTagId: 'post_tag_1' })
    )
    expect(hoisted.completeImportRun).toHaveBeenCalledWith(
      'import_run_1',
      { rows: 5, created: 4, updated: 0, skipped: 1, errors: 1 },
      [{ row: 3, message: 'bad row' }]
    )
    expect(hoisted.failImportRun).not.toHaveBeenCalled()
  })

  it('passes through the updated count from source-id idempotence matches', async () => {
    hoisted.processImport.mockResolvedValue({
      imported: 2,
      updated: 3,
      skipped: 0,
      errors: [],
      createdTags: [],
    })

    await runImportCommitJob({ runId: 'import_run_updated' as never, source: 'csv', input: BASE_INPUT })

    expect(hoisted.completeImportRun).toHaveBeenCalledWith(
      'import_run_updated',
      { rows: 5, created: 2, updated: 3, skipped: 0, errors: 0 },
      []
    )
  })

  it('fails the run when the pipeline throws', async () => {
    hoisted.processImport.mockRejectedValue(new Error('CSV parsing failed'))

    await runImportCommitJob({ runId: 'import_run_2' as never, source: 'uservoice', input: BASE_INPUT })

    expect(hoisted.failImportRun).toHaveBeenCalledWith('import_run_2', 'CSV parsing failed')
    expect(hoisted.completeImportRun).not.toHaveBeenCalled()
  })

  it('fails the run when the batch tag cannot be created', async () => {
    hoisted.ensureBatchTag.mockRejectedValue(new Error('tag creation failed'))

    await runImportCommitJob({ runId: 'import_run_3' as never, source: 'canny', input: BASE_INPUT })

    expect(hoisted.markImportRunRunning).not.toHaveBeenCalled()
    expect(hoisted.processImport).not.toHaveBeenCalled()
    expect(hoisted.failImportRun).toHaveBeenCalledWith('import_run_3', 'tag creation failed')
  })
})
