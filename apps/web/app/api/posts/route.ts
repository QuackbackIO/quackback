import { NextRequest, NextResponse } from 'next/server'
import { getInboxPostList, createPost, setPostTags, getBoardById } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { createPostSchema, type PostStatus } from '@/lib/schemas/posts'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Parse filter params
    const boardIds = searchParams.getAll('board')
    const status = searchParams.getAll('status') as PostStatus[]
    const tagIds = searchParams.getAll('tags')
    const ownerParam = searchParams.get('owner')
    const search = searchParams.get('search') || undefined
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const minVotes = searchParams.get('minVotes')
    const sort = (searchParams.get('sort') as 'newest' | 'oldest' | 'votes') || 'newest'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    // Handle owner filter - 'unassigned' means null
    let ownerId: string | null | undefined
    if (ownerParam === 'unassigned') {
      ownerId = null
    } else if (ownerParam) {
      ownerId = ownerParam
    }

    const result = await getInboxPostList({
      organizationId: validation.organization.id,
      boardIds: boardIds.length > 0 ? boardIds : undefined,
      status: status.length > 0 ? status : undefined,
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      ownerId,
      search,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      minVotes: minVotes ? parseInt(minVotes, 10) : undefined,
      sort,
      page,
      limit,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching posts:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Validate the post data with Zod schema
    const result = createPostSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { title, content, boardId, status, tagIds } = result.data

    // Verify the board belongs to this organization
    const board = await getBoardById(boardId)
    if (!board || board.organizationId !== organizationId) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Create the post with member-scoped identity
    const post = await createPost({
      boardId,
      title,
      content,
      status: status || 'open',
      // Member-scoped identity (Hub-and-Spoke model)
      memberId: validation.member.id,
      // Legacy fields for display compatibility
      authorName: validation.user.name || 'Team',
      authorEmail: validation.user.email,
    })

    // Add tags if provided
    if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
      await setPostTags(post.id, tagIds)
    }

    return NextResponse.json(post, { status: 201 })
  } catch (error) {
    console.error('Error creating post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
