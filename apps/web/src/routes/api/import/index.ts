import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import Papa from 'papaparse'
import type { ImportInput } from '@/lib/server/domains/import/types'
import { REQUIRED_HEADERS } from '@/lib/shared/schemas/import'
import { isValidTypeId, type BoardId } from '@quackback/ids'
import { contentLengthExceeds } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import' })

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
// Content-Length covers the whole multipart body (boundaries + fields), so
// allow a little framing slack; the post-parse file-size check is authoritative.
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 64 * 1024
const MAX_ROWS = 10000

/**
 * POST /api/import - upload a CSV, dry-run or enqueue it for async processing.
 * Authenticates before touching the body: a cheap Content-Length pre-check
 * rejects oversized uploads with 413 before the multipart body is buffered.
 *
 * `mode=dry_run` (§I2) validates and resolves every row without writing
 * anything and returns the preview summary directly (200) — the wizard's
 * mapping steps run before this call, so the file has already been remapped
 * onto the canonical headers by the time it reaches here.
 *
 * `mode=commit` (default, §I1) is async: it creates an `import_runs` row,
 * enqueues the commit job, and returns the run id immediately (202) — the
 * caller polls GET /api/import/runs/{id} for status, totals, and the error
 * report.
 */
export async function handleImportPost(request: Request): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')
  const { previewImport } = await import('@/lib/server/domains/import/import-preview')
  const { createImportRun } = await import('@/lib/server/domains/import/import-run.service')
  const { enqueueImportCommitJob } = await import('@/lib/server/domains/import/import-queue')
  const { getBoardById, listBoards } = await import('@/lib/server/domains/boards/board.service')

  try {
    // Validate workspace access before reading the request body
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin can import
    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      log.warn({ role: validation.principal.role }, 'import access denied')
      return Response.json({ error: 'Only admins can import data' }, { status: 403 })
    }

    // Cheap pre-check: reject an oversized body before buffering it. A missing
    // or garbage Content-Length is inconclusive and falls through to the
    // post-parse file-size backstop below.
    if (contentLengthExceeds(request, MAX_REQUEST_SIZE)) {
      return Response.json({ error: 'Request body exceeds 10MB limit' }, { status: 413 })
    }

    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const boardIdParam = formData.get('boardId') as string | null
    const modeParam = formData.get('mode') as string | null
    const mode = modeParam === 'dry_run' ? 'dry_run' : 'commit'
    const sourceParam = formData.get('source') as string | null
    const source = sourceParam === 'uservoice' || sourceParam === 'canny' ? sourceParam : 'csv'

    log.info(
      { file_name: file?.name || 'none', file_size: file?.size || 0, mode },
      'csv import started'
    )

    // Validate file
    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return Response.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
    }

    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      return Response.json({ error: 'File must be a CSV' }, { status: 400 })
    }

    // Validate boardId TypeID format
    let boardId: BoardId | null = null
    if (boardIdParam) {
      if (!isValidTypeId(boardIdParam, 'board')) {
        return Response.json({ error: 'Invalid board ID format' }, { status: 400 })
      }
      boardId = boardIdParam as BoardId
    }

    // Validate board exists
    let targetBoardId: BoardId | null = boardId
    if (boardId) {
      try {
        await getBoardById(boardId)
      } catch {
        return Response.json({ error: 'Board not found' }, { status: 400 })
      }
    } else {
      // Use first board if none specified
      const boards = await listBoards()
      if (boards.length === 0) {
        return Response.json({ error: 'No boards found. Create a board first.' }, { status: 400 })
      }
      targetBoardId = boards[0].id
    }

    // Read file content
    const csvText = await file.text()

    // Parse CSV to validate structure
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      preview: 1, // Just parse first row to validate headers
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
    })

    if (parseResult.errors.length > 0) {
      return Response.json(
        { error: `CSV parsing error: ${parseResult.errors[0].message}` },
        { status: 400 }
      )
    }

    // Check for required headers
    const headers = parseResult.meta.fields || []
    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length > 0) {
      return Response.json(
        { error: `Missing required columns: ${missingHeaders.join(', ')}` },
        { status: 400 }
      )
    }

    // Count total rows (excluding header)
    const fullParse = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
    })
    const totalRows = fullParse.data.length

    if (totalRows === 0) {
      return Response.json({ error: 'CSV file is empty' }, { status: 400 })
    }

    if (totalRows > MAX_ROWS) {
      return Response.json({ error: `File exceeds maximum of ${MAX_ROWS} rows` }, { status: 400 })
    }

    // Encode CSV as base64 for the import service
    const csvContent = Buffer.from(csvText).toString('base64')

    const importData: ImportInput = {
      boardId: targetBoardId!,
      csvContent,
      totalRows,
      initiatedByPrincipalId: validation.principal.id,
    }

    if (mode === 'dry_run') {
      log.info({ total_rows: totalRows }, 'previewing import rows')
      const preview = await previewImport(importData)
      return Response.json(preview)
    }

    log.info({ total_rows: totalRows }, 'queuing import rows')

    const run = await createImportRun({
      source,
      fileName: file.name,
      initiatedByPrincipalId: validation.principal.id,
    })

    await enqueueImportCommitJob({ runId: run.id, source, input: importData })

    log.info({ run_id: run.id }, 'csv import enqueued')
    return Response.json({ runId: run.id, status: run.status, totalRows }, { status: 202 })
  } catch (error) {
    log.error({ err: error }, 'csv import failed')
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: errorMessage }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/import/')({
  server: {
    handlers: {
      POST: ({ request }) => handleImportPost(request),
    },
  },
})
