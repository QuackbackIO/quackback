import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getJobAdapter } from '@quackback/jobs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Validate tenant access
    const validation = await validateApiTenantAccess()
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 })
    }

    // Extract workspaceId from jobId (format: import-{workspaceId}-{timestamp})
    // Example: import-workspace_01h455vb4pex5vsknk084sn02q-1702000000000
    const parts = jobId.split('-')
    if (parts.length < 3 || parts[0] !== 'import') {
      return NextResponse.json({ error: 'Invalid job ID format' }, { status: 400 })
    }

    // parts[1] is the workspace TypeID - verify it matches the user's organization
    const workspaceIdFromJob = parts.slice(1, -1).join('-') // Handle TypeIDs that may contain dashes
    if (workspaceIdFromJob !== validation.settings.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get job status via adapter
    const jobAdapter = getJobAdapter()
    const status = await jobAdapter.getImportJobStatus(jobId)

    if (!status) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('Error fetching job status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
