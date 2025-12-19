import { NextRequest, NextResponse } from 'next/server'
import { getRoadmapService } from '@/lib/services'
import { isValidTypeId, type WorkspaceId } from '@quackback/ids'

/**
 * GET /api/public/roadmaps
 * List public roadmaps for an organization (no auth required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const workspaceIdParam = searchParams.get('workspaceId')

    if (!workspaceIdParam) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    if (!isValidTypeId(workspaceIdParam, 'workspace')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const workspaceId = workspaceIdParam as WorkspaceId

    const result = await getRoadmapService().listPublicRoadmaps(workspaceId)

    if (!result.success) {
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }

    // Response is already in TypeID format from service layer
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public roadmaps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
