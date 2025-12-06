import { NextResponse } from 'next/server'
import { getInboxPostList, createPost, setPostTags, getBoardById } from '@quackback/db'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { createPostSchema, type PostStatus } from '@/lib/schemas/posts'

export const GET = withApiHandler(async (request, { validation }) => {
  const { searchParams } = new URL(request.url)

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
})

export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const { title, content, boardId, status, tagIds } = validateBody(createPostSchema, body)

  // Verify the board belongs to this organization
  const board = await getBoardById(boardId)
  if (!board || board.organizationId !== validation.organization.id) {
    throw new ApiError('Board not found', 404)
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

  return successResponse(post, 201)
})
