import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { validateApiTenantAccess } from '@/lib/tenant'
import { addImportJob, type ImportJobData } from '@quackback/jobs'
import { REQUIRED_HEADERS } from '@/lib/schemas/import'
import { db, boards, eq, and } from '@quackback/db'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_ROWS = 10000

export async function POST(request: NextRequest) {
  try {
    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const boardId = formData.get('boardId') as string | null
    const organizationId = formData.get('organizationId') as string | null

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin/owner can import
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Only admins can import data' }, { status: 403 })
    }

    // Validate file
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
    }

    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'File must be a CSV' }, { status: 400 })
    }

    // Validate board exists and belongs to organization
    let targetBoardId = boardId
    if (boardId) {
      const board = await db.query.boards.findFirst({
        where: and(eq(boards.id, boardId), eq(boards.organizationId, validation.organization.id)),
      })
      if (!board) {
        return NextResponse.json({ error: 'Board not found' }, { status: 400 })
      }
    } else {
      // Use first board if none specified
      const firstBoard = await db.query.boards.findFirst({
        where: eq(boards.organizationId, validation.organization.id),
      })
      if (!firstBoard) {
        return NextResponse.json(
          { error: 'No boards found. Create a board first.' },
          { status: 400 }
        )
      }
      targetBoardId = firstBoard.id
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
      return NextResponse.json(
        { error: `CSV parsing error: ${parseResult.errors[0].message}` },
        { status: 400 }
      )
    }

    // Check for required headers
    const headers = parseResult.meta.fields || []
    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))
    if (missingHeaders.length > 0) {
      return NextResponse.json(
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
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 })
    }

    if (totalRows > MAX_ROWS) {
      return NextResponse.json(
        { error: `File exceeds maximum of ${MAX_ROWS} rows` },
        { status: 400 }
      )
    }

    // Encode CSV as base64 for job queue
    const csvContent = Buffer.from(csvText).toString('base64')

    // Create job data
    const jobData: ImportJobData = {
      organizationId: validation.organization.id,
      boardId: targetBoardId!,
      csvContent,
      totalRows,
      initiatedByMemberId: validation.member.id,
    }

    // Add job to queue
    const jobId = await addImportJob(jobData)

    return NextResponse.json({
      jobId,
      status: 'waiting',
      totalRows,
    })
  } catch (error) {
    console.error('Error creating import job:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
