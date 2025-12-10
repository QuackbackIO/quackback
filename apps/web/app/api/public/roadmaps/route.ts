import { NextRequest, NextResponse } from 'next/server'
import { getRoadmapService } from '@/lib/services'

/**
 * GET /api/public/roadmaps
 * List public roadmaps for an organization (no auth required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const result = await getRoadmapService().listPublicRoadmaps(organizationId)

    if (!result.success) {
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public roadmaps:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
