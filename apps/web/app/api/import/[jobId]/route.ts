import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getSession } from '@/lib/auth/server'
import { db, member, eq, and } from '@/lib/db'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'
import { isValidTypeId, type OrgId } from '@quackback/ids'

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
    // TypeID format: import-org_01h455vb4pex5vsknk084sn02q-1702000000000
    const parts = jobId.split('-')
    if (parts.length !== 3 || parts[0] !== 'import') {
      return NextResponse.json({ error: 'Invalid job ID format' }, { status: 400 })
    }

    // parts[1] is the TypeID (org_...)
    const orgIdFromJob = parts[1] as OrgId
    if (!isValidTypeId(orgIdFromJob, 'org')) {
      return NextResponse.json({ error: 'Invalid job ID format' }, { status: 400 })
    }

    // Verify user belongs to this organization via member table
    const memberRecord = await db.query.member.findFirst({
      where: and(eq(member.userId, session.user.id), eq(member.organizationId, orgIdFromJob)),
    })

    if (!memberRecord) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get job status via adapter (BullMQ or Workflow)
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
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
