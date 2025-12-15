import { NextRequest, NextResponse } from 'next/server'
import { getRoadmapService } from '@/lib/services'
import { isValidTypeId, type OrgId } from '@quackback/ids'

/**
 * GET /api/public/roadmaps
 * List public roadmaps for an organization (no auth required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationIdParam = searchParams.get('organizationId')

    if (!organizationIdParam) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    if (!isValidTypeId(organizationIdParam, 'org')) {
      return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
    }
    const organizationId = organizationIdParam as OrgId

    const result = await getRoadmapService().listPublicRoadmaps(organizationId)

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
