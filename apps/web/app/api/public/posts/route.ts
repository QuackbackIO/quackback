import { NextRequest, NextResponse } from 'next/server'
import { getPublicPostListAllBoards } from '@quackback/db/queries/public'
import { db, organization, eq } from '@quackback/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Validate organization exists
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
    })

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Parse filter params
    const board = searchParams.get('board') || undefined
    const search = searchParams.get('search') || undefined
    const sort = (searchParams.get('sort') as 'top' | 'new' | 'trending') || 'top'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    const result = await getPublicPostListAllBoards({
      organizationId,
      boardSlug: board,
      search,
      sort,
      page,
      limit,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching public posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
