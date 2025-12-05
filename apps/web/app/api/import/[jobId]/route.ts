import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { getImportJobStatus } from '@quackback/jobs'

// UUID regex for validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { jobId } = await params

    if (!jobId) {
      return NextResponse.json({ error: 'Job ID is required' }, { status: 400 })
    }

    // Extract and verify organizationId from jobId (format: import-{orgId}-{timestamp})
    const parts = jobId.split('-')
    if (parts.length < 7 || parts[0] !== 'import') {
      return NextResponse.json({ error: 'Invalid job ID format' }, { status: 400 })
    }

    // UUID is parts 1-5 (5 segments separated by dashes)
    const orgIdFromJob = parts.slice(1, 6).join('-')
    if (!UUID_REGEX.test(orgIdFromJob)) {
      return NextResponse.json({ error: 'Invalid job ID format' }, { status: 400 })
    }

    // Verify user belongs to this organization
    if (session.user.organizationId !== orgIdFromJob) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get job status from BullMQ
    const status = await getImportJobStatus(jobId)

    if (!status) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('Error fetching job status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
