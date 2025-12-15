import { NextRequest, NextResponse } from 'next/server'
import { getRoadmapService } from '@/lib/services'
import { isValidTypeId, type OrgId, type RoadmapId, type StatusId } from '@quackback/ids'

/**
 * GET /api/public/roadmaps/[roadmapId]/posts
 * Get posts for a public roadmap (no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roadmapId: string }> }
) {
  try {
    const { roadmapId: roadmapIdParam } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Validate organizationId TypeID format
    if (!isValidTypeId(organizationId, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const orgId = organizationId as OrgId

    // Validate TypeID format
    if (!isValidTypeId(roadmapIdParam, 'roadmap')) {
      return NextResponse.json({ error: 'Invalid roadmap ID format' }, { status: 400 })
    }
    const roadmapId = roadmapIdParam as RoadmapId

    // Parse optional statusId TypeID
    const statusIdParam = searchParams.get('statusId')
    let statusId: StatusId | undefined
    if (statusIdParam) {
      if (!isValidTypeId(statusIdParam, 'status')) {
        return NextResponse.json({ error: 'Invalid status ID format' }, { status: 400 })
      }
      statusId = statusIdParam as StatusId
    }

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const result = await getRoadmapService().getPublicRoadmapPosts(orgId, roadmapId, {
      statusId,
      limit,
      offset,
    })

    if (!result.success) {
      const status = result.error.code === 'ROADMAP_NOT_FOUND' ? 404 : 500
      return NextResponse.json({ error: result.error.message }, { status })
    }

    // Response is already in TypeID format from service layer
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public roadmap posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
