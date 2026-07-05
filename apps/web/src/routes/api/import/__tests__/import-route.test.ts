/**
 * Unit tests for the CSV import handler (POST /api/import).
 *
 * Pins the hardened request order: authenticate first, then a cheap
 * Content-Length pre-check (413 before the body is buffered), then the
 * multipart parse with the post-parse file-size check as the backstop.
 *
 * Async since §I1: the route creates an import_runs row and enqueues a
 * commit job rather than processing inline, so these tests assert against
 * the { runId, status } 202 contract instead of inline counts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockCreateImportRun: vi.fn(),
  mockEnqueueImportCommitJob: vi.fn(),
  mockGetBoardById: vi.fn(),
  mockListBoards: vi.fn(),
  mockPreviewImport: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/import/import-run.service', () => ({
  createImportRun: hoisted.mockCreateImportRun,
}))

vi.mock('@/lib/server/domains/import/import-queue', () => ({
  enqueueImportCommitJob: hoisted.mockEnqueueImportCommitJob,
}))

vi.mock('@/lib/server/domains/import/import-preview', () => ({
  previewImport: hoisted.mockPreviewImport,
}))

vi.mock('@/lib/server/domains/boards/board.service', () => ({
  getBoardById: hoisted.mockGetBoardById,
  listBoards: hoisted.mockListBoards,
}))

import { handleImportPost } from '../index'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type FakeFile = { name: string; type: string; size: number; text: () => Promise<string> }

const csvFile = (csv: string): FakeFile => ({
  name: 'import.csv',
  type: 'text/csv',
  size: csv.length,
  text: async () => csv,
})

/** Request stub exposing a spy-able formData so tests can assert the body was never read. */
function makeRequest(opts: {
  contentLength?: number
  file?: FakeFile | null
  fields?: Record<string, string>
}) {
  const form = {
    get: (key: string) => {
      if (key === 'file') return opts.file ?? null
      return opts.fields?.[key] ?? null
    },
  }
  const headers = new Headers()
  if (opts.contentLength !== undefined) headers.set('content-length', String(opts.contentLength))
  const formData = vi.fn(async () => form)
  return { request: { headers, formData } as unknown as Request, formData }
}

const VALID_CSV = 'title,content\nFirst post,Body text\n'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin' },
  })
  hoisted.mockListBoards.mockResolvedValue([{ id: 'board_1' }])
  hoisted.mockCreateImportRun.mockResolvedValue({ id: 'import_run_1', status: 'pending' })
  hoisted.mockEnqueueImportCommitJob.mockResolvedValue(undefined)
})

describe('POST /api/import — auth before body parse', () => {
  it('returns the auth error without reading the body', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
      status: 401,
    })
    const { request, formData } = makeRequest({ file: csvFile(VALID_CSV) })

    const res = await handleImportPost(request)

    expect(res.status).toBe(401)
    expect(formData).not.toHaveBeenCalled()
  })

  it('rejects non-admins without reading the body', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member' },
    })
    const { request, formData } = makeRequest({ file: csvFile(VALID_CSV) })

    const res = await handleImportPost(request)

    expect(res.status).toBe(403)
    expect(formData).not.toHaveBeenCalled()
  })
})

describe('POST /api/import — Content-Length pre-check', () => {
  it('returns 413 for an oversized Content-Length before buffering the body', async () => {
    const { request, formData } = makeRequest({
      contentLength: 20 * 1024 * 1024,
      file: csvFile(VALID_CSV),
    })

    const res = await handleImportPost(request)

    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('10MB')
    expect(formData).not.toHaveBeenCalled()
    expect(hoisted.mockCreateImportRun).not.toHaveBeenCalled()
    expect(hoisted.mockEnqueueImportCommitJob).not.toHaveBeenCalled()
  })

  it('enqueues a request whose Content-Length is within the limit and returns the run id', async () => {
    const { request } = makeRequest({
      contentLength: VALID_CSV.length + 200,
      file: csvFile(VALID_CSV),
    })

    const res = await handleImportPost(request)

    expect(res.status).toBe(202)
    const body = (await res.json()) as { runId: string; status: string; totalRows: number }
    expect(body.runId).toBe('import_run_1')
    expect(body.status).toBe('pending')
    expect(body.totalRows).toBe(1)
    expect(hoisted.mockCreateImportRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'csv', fileName: 'import.csv' })
    )
    expect(hoisted.mockEnqueueImportCommitJob).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'import_run_1', source: 'csv' })
    )
  })
})

describe('POST /api/import — post-parse backstop', () => {
  it('still rejects an oversized file when Content-Length is missing', async () => {
    const bigFile: FakeFile = {
      name: 'big.csv',
      type: 'text/csv',
      size: MAX_FILE_SIZE + 1,
      text: async () => '',
    }
    const { request } = makeRequest({ file: bigFile })

    const res = await handleImportPost(request)

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('10MB')
    expect(hoisted.mockCreateImportRun).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is provided', async () => {
    const { request } = makeRequest({ file: null })

    const res = await handleImportPost(request)

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('No file provided')
  })
})

describe('POST /api/import — mode=dry_run (§I2)', () => {
  it('returns the preview synchronously instead of enqueuing a run', async () => {
    hoisted.mockPreviewImport.mockResolvedValue({
      totalRows: 1,
      counts: { byBoard: {}, byStatus: {}, byAuthor: {} },
      sample: [],
      errors: [],
      updatedCount: 0,
    })
    const { request } = makeRequest({ file: csvFile(VALID_CSV), fields: { mode: 'dry_run' } })

    const res = await handleImportPost(request)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { totalRows: number }
    expect(body.totalRows).toBe(1)
    expect(hoisted.mockPreviewImport).toHaveBeenCalledTimes(1)
    expect(hoisted.mockCreateImportRun).not.toHaveBeenCalled()
    expect(hoisted.mockEnqueueImportCommitJob).not.toHaveBeenCalled()
  })

  it('still enqueues a run when mode is omitted (defaults to commit)', async () => {
    const { request } = makeRequest({ file: csvFile(VALID_CSV) })

    const res = await handleImportPost(request)

    expect(res.status).toBe(202)
    expect(hoisted.mockPreviewImport).not.toHaveBeenCalled()
    expect(hoisted.mockEnqueueImportCommitJob).toHaveBeenCalled()
  })
})

describe('POST /api/import — votersJson (§I3)', () => {
  it('parses votersJson and threads it onto the enqueued job input', async () => {
    const voters = { 'idea-1': [{ email: 'alice@example.com' }] }
    const { request } = makeRequest({
      file: csvFile(VALID_CSV),
      fields: { source: 'uservoice', votersJson: JSON.stringify(voters) },
    })

    const res = await handleImportPost(request)

    expect(res.status).toBe(202)
    expect(hoisted.mockEnqueueImportCommitJob).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'uservoice', input: expect.objectContaining({ voters }) })
    )
  })

  it('ignores malformed votersJson rather than failing the request', async () => {
    const { request } = makeRequest({
      file: csvFile(VALID_CSV),
      fields: { votersJson: 'not json' },
    })

    const res = await handleImportPost(request)

    expect(res.status).toBe(202)
    expect(hoisted.mockEnqueueImportCommitJob).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ voters: undefined }) })
    )
  })
})
