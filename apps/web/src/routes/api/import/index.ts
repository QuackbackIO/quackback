import { createFileRoute } from '@tanstack/react-router'
import Papa from 'papaparse'
import type { ImportInput } from '@/lib/import/types'
import { REQUIRED_HEADERS } from '@/lib/schemas/import'
import { isValidTypeId, type BoardId } from '@quackback/ids'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_ROWS = 10000

export const Route = createFileRoute('/api/import/')({
  server: {
    handlers: {
      /**
       * POST /api/import
       * Upload and queue CSV import job
       */
      POST: async ({ request }) => {
        const { validateApiWorkspaceAccess } = await import('@/lib/server-functions/workspace')
        const { requireRole } = await import('@/lib/api-handler')
        const { processImport } = await import('@/lib/import/import-service')
        const { getBoardById, listBoards } = await import('@/lib/boards/board.service')

        try {
          // Parse multipart form data
          const formData = await request.formData()
          const file = formData.get('file') as File | null
          const boardIdParam = formData.get('boardId') as string | null

          // Validate workspace access
          const validation = await validateApiWorkspaceAccess()
          if (!validation.success) {
            return Response.json({ error: validation.error }, { status: validation.status })
          }

          // Check role - only admin/owner can import
          if (!requireRole(validation.member.role, ['owner', 'admin'])) {
            return Response.json({ error: 'Only admins can import data' }, { status: 403 })
          }

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
            const boardResult = await getBoardById(boardId)
            if (!boardResult.success) {
              return Response.json({ error: 'Board not found' }, { status: 400 })
            }
          } else {
            // Use first board if none specified
            const boardsResult = await listBoards()
            if (!boardsResult.success || boardsResult.value.length === 0) {
              return Response.json(
                { error: 'No boards found. Create a board first.' },
                { status: 400 }
              )
            }
            targetBoardId = boardsResult.value[0].id
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
            return Response.json(
              { error: `File exceeds maximum of ${MAX_ROWS} rows` },
              { status: 400 }
            )
          }

          // Encode CSV as base64 for job queue
          const csvContent = Buffer.from(csvText).toString('base64')

          // Create import data
          const importData: ImportInput = {
            boardId: targetBoardId!,
            csvContent,
            totalRows,
            initiatedByMemberId: validation.member.id,
          }

          // Process import inline (synchronous)
          const result = await processImport(importData)

          return Response.json({
            imported: result.imported,
            skipped: result.skipped,
            errors: result.errors,
            createdTags: result.createdTags,
            totalRows,
          })
        } catch (error) {
          console.error('Error processing import:', error)
          const errorMessage = error instanceof Error ? error.message : 'Internal server error'
          return Response.json({ error: errorMessage }, { status: 500 })
        }
      },
    },
  },
})
