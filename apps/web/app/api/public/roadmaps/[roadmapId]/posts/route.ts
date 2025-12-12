import { NextRequest, NextResponse } from 'next/server'
import { getRoadmapService } from '@/lib/services'

/**
 * GET /api/public/roadmaps/[roadmapId]/posts
 * Get posts for a public roadmap (no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roadmapId: string }> }
) {
  try {
    const { roadmapId } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const statusId = searchParams.get('statusId') || undefined
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const result = await getRoadmapService().getPublicRoadmapPosts(organizationId, roadmapId, {
      statusId,
      limit,
      offset,
    })

    if (!result.success) {
      const status = result.error.code === 'ROADMAP_NOT_FOUND' ? 404 : 500
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public roadmap posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
