import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/server'
import { publicPostSchema } from '@/lib/schemas/posts'
import { getBoardService, getStatusService, getPostService, getMemberService } from '@/lib/services'
import { buildServiceContext, buildPostCreatedEvent, type ServiceContext } from '@quackback/domain'
import { isValidTypeId, type BoardId } from '@quackback/ids'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'

interface RouteParams {
  params: Promise<{ boardId: string }>
}

/**
 * POST /api/public/boards/[boardId]/posts
 *
 * Create a new post on a public board.
 * Requires authentication (member of the organization).
 * Posts are auto-published with the default status.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { boardId: boardIdParam } = await params

  // Validate TypeID format
  if (!isValidTypeId(boardIdParam, 'board')) {
    return NextResponse.json({ error: 'Invalid board ID format' }, { status: 400 })
  }
  const boardId = boardIdParam as BoardId

  // 1. Get board and verify it exists and is public
  const boardResult = await getBoardService().getPublicBoardById(boardId)
  if (!boardResult.success) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  const board = boardResult.value

  if (!board.isPublic) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  // 2. Check authentication
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required. Please sign in to submit feedback.' },
      { status: 401 }
    )
  }

  // 3. Get member record for this organization
  const memberResult = await getMemberService().getMemberByUserAndOrg(
    session.user.id,
    board.workspaceId
  )
  const memberRecord = memberResult.success ? memberResult.value : null

  if (!memberRecord) {
    return NextResponse.json(
      { error: 'You must be a member of this workspace to submit feedback.' },
      { status: 403 }
    )
  }

  // 4. Build service context for domain operations
  const ctx: ServiceContext = buildServiceContext({
    workspace: { id: board.workspaceId },
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    member: {
      id: memberRecord.id,
      role: memberRecord.role,
    },
  })

  // 5. Validate request body
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = publicPostSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message || 'Invalid input' },
      { status: 400 }
    )
  }

  const { title, content, contentJson } = result.data

  // 6. Get default status for this organization
  const defaultStatusResult = await getStatusService().getDefaultStatus(ctx)
  if (!defaultStatusResult.success) {
    return NextResponse.json({ error: 'Failed to retrieve default status' }, { status: 500 })
  }

  // 7. Create the post
  const defaultStatus = defaultStatusResult.value
  const createResult = await getPostService().createPost(
    {
      boardId,
      title,
      content,
      contentJson,
      statusId: defaultStatus?.id,
    },
    ctx
  )

  if (!createResult.success) {
    return NextResponse.json(
      { error: createResult.error.message },
      { status: createResult.error.code === 'VALIDATION_ERROR' ? 400 : 500 }
    )
  }

  const { boardSlug, ...post } = createResult.value

  // Trigger EventWorkflow for integrations and notifications
  const eventData = buildPostCreatedEvent(
    ctx.workspaceId,
    { type: 'user', userId: ctx.userId, email: ctx.userEmail },
    {
      id: post.id,
      title: post.title,
      content: post.content,
      boardId: post.boardId,
      boardSlug,
      authorEmail: ctx.userEmail,
      voteCount: post.voteCount,
    }
  )
  const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
  const jobAdapter = getJobAdapter(env)
  await jobAdapter.addEventJob(eventData)

  // Include board details in response (client needs it for optimistic updates)
  return NextResponse.json(
    {
      id: post.id,
      title: post.title,
      content: post.content,
      statusId: post.statusId,
      voteCount: post.voteCount,
      createdAt: post.createdAt,
      board: {
        id: board.id,
        name: board.name,
        slug: board.slug,
      },
    },
    { status: 201 }
  )
}
