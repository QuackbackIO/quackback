import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { validateApiTenantAccess } from '@/lib/tenant'
import { requireRole } from '@/lib/api-handler'
import { getJobAdapter, isCloudflareWorker, type ImportJobData } from '@quackback/jobs'
import { REQUIRED_HEADERS } from '@/lib/schemas/import'
import { getBoardService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { isValidTypeId, type BoardId, type OrgId } from '@quackback/ids'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_ROWS = 10000

export async function POST(request: NextRequest) {
  try {
    // Parse multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const boardIdParam = formData.get('boardId') as string | null
    const organizationIdParam = formData.get('organizationId') as string | null

    // Validate organization ID format
    if (!organizationIdParam || !isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check role - only admin/owner can import
    if (!requireRole(validation.member.role, ['owner', 'admin'])) {
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

    // Build service context
    const ctx = buildServiceContext(validation)
    const boardService = getBoardService()

    // Validate boardId TypeID format
    let boardId: BoardId | null = null
    if (boardIdParam) {
      if (!isValidTypeId(boardIdParam, 'board')) {
        return NextResponse.json({ error: 'Invalid board ID format' }, { status: 400 })
      }
      boardId = boardIdParam as BoardId
    }

    // Validate board exists and belongs to organization
    let targetBoardId: BoardId | null = boardId
    if (boardId) {
      const boardResult = await boardService.validateBoardBelongsToOrg(
        boardId,
        validation.organization.id
      )
      if (!boardResult.success) {
        return NextResponse.json({ error: 'Board not found' }, { status: 400 })
      }
    } else {
      // Use first board if none specified
      const boardsResult = await boardService.listBoards(ctx)
      if (!boardsResult.success || boardsResult.value.length === 0) {
        return NextResponse.json(
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

    // Get job adapter based on runtime environment
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)

    // Add job to queue/workflow
    const jobId = await jobAdapter.addImportJob(jobData)

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
