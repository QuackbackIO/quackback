import { NextRequest, NextResponse } from 'next/server'
import { getBoardSettings } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { publicPostSchema } from '@/lib/schemas/posts'
import { getBoardService, getStatusService, getPostService, getMemberService } from '@/lib/services'
import { buildServiceContext, type ServiceContext } from '@quackback/domain'

interface RouteParams {
  params: Promise<{ boardId: string }>
}

/**
 * POST /api/public/boards/[boardId]/posts
 *
 * Create a new post on a public board.
 * Requires authentication (portal user or team member).
 * Posts are auto-published with the default status.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { boardId } = await params

  // 1. Get board and verify it exists and is public
  const boardResult = await getBoardService().getPublicBoardById(boardId)
  if (!boardResult.success) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  const board = boardResult.value

  if (!board.isPublic) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  // 2. Check if user submissions are enabled for this board
  const settings = getBoardSettings(board)
  if (!settings.submissionsEnabled) {
    return NextResponse.json(
      { error: 'Post submissions are disabled for this board' },
      { status: 403 }
    )
  }

  // 3. Require authentication
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required. Please sign in to submit feedback.' },
      { status: 401 }
    )
  }

  // 4. Get member record for this organization
  const memberResult = await getMemberService().getMemberByUserAndOrg(
    session.user.id,
    board.organizationId
  )
  const memberRecord = memberResult.success ? memberResult.value : null

  if (!memberRecord) {
    return NextResponse.json(
      { error: 'You must be a member of this organization to submit feedback' },
      { status: 403 }
    )
  }

  // 5. Build service context for domain operations
  const ctx: ServiceContext = buildServiceContext({
    organization: { id: board.organizationId },
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

  // 6. Validate request body
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

  // 7. Get default status for this organization
  const defaultStatusResult = await getStatusService().getDefaultStatus(ctx)
  if (!defaultStatusResult.success) {
    return NextResponse.json({ error: 'Failed to retrieve default status' }, { status: 500 })
  }

  // 8. Create the post via the PostService
  const createResult = await getPostService().createPost(
    {
      boardId,
      title,
      content,
      contentJson,
      // The service uses the legacy 'status' field, not statusId
      // We'll need to update the post with statusId after creation if a default status exists
      status: 'open', // Use legacy default
    },
    ctx
  )

  if (!createResult.success) {
    return NextResponse.json(
      { error: createResult.error.message },
      { status: createResult.error.code === 'VALIDATION_ERROR' ? 400 : 500 }
    )
  }

  const post = createResult.value

  // 9. Update post with custom statusId if a default status exists
  // This is necessary because the PostService doesn't currently support statusId in CreatePostInput
  const defaultStatus = defaultStatusResult.value
  if (defaultStatus) {
    const updateResult = await getPostService().changeStatus(post.id, defaultStatus.id, ctx)
    if (!updateResult.success) {
      // Log error but don't fail the request - post was created successfully
      console.error('Failed to set default status on post:', updateResult.error)
    }
  }

  return NextResponse.json(post, { status: 201 })
}
