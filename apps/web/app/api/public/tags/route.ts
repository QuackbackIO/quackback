import { NextRequest, NextResponse } from 'next/server'
import { getTagService } from '@/lib/services'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    const tagService = getTagService()
    const result = await tagService.listPublicTags(organizationId)

    if (!result.success) {
      return NextResponse.json({ error: result.error.message }, { status: 500 })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error fetching public tags:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
