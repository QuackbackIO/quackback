/**
 * Unit tests for the CSV import handler (POST /api/import).
 *
 * Pins the hardened request order: authenticate first, then a cheap
 * Content-Length pre-check (413 before the body is buffered), then the
 * multipart parse with the post-parse file-size check as the backstop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockProcessImport: vi.fn(),
  mockGetBoardById: vi.fn(),
  mockListBoards: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/import/import-service', () => ({
  processImport: hoisted.mockProcessImport,
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
function makeRequest(opts: { contentLength?: number; file?: FakeFile | null }) {
  const form = { get: (key: string) => (key === 'file' ? (opts.file ?? null) : null) }
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
  hoisted.mockProcessImport.mockResolvedValue({
    imported: 1,
    skipped: 0,
    errors: [],
    createdTags: [],
  })
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
    expect(hoisted.mockProcessImport).not.toHaveBeenCalled()
  })

  it('processes a request whose Content-Length is within the limit', async () => {
    const { request } = makeRequest({
      contentLength: VALID_CSV.length + 200,
      file: csvFile(VALID_CSV),
    })

    const res = await handleImportPost(request)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { imported: number; totalRows: number }
    expect(body.imported).toBe(1)
    expect(body.totalRows).toBe(1)
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
    expect(hoisted.mockProcessImport).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is provided', async () => {
    const { request } = makeRequest({ file: null })

    const res = await handleImportPost(request)

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('No file provided')
  })
})
