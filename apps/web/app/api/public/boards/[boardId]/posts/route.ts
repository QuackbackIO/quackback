import { NextRequest, NextResponse } from 'next/server'
import { getPublicBoardById } from '@quackback/db/queries/public'
import { createPost, getDefaultStatus, getBoardSettings, db, member, eq, and } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { publicPostSchema } from '@/lib/schemas/posts'

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
  const board = await getPublicBoardById(boardId)
  if (!board) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  if (!board.isPublic) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  // 2. Check if user submissions are enabled for this board
  const settings = getBoardSettings(board)
  if (!settings.allowUserSubmissions) {
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
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.userId, session.user.id), eq(member.organizationId, board.organizationId)),
  })

  if (!memberRecord) {
    return NextResponse.json(
      { error: 'You must be a member of this organization to submit feedback' },
      { status: 403 }
    )
  }

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

  const { title, content } = result.data

  // 6. Get default status for this organization
  const defaultStatus = await getDefaultStatus(board.organizationId)

  // 7. Create the post with the default status
  const post = await createPost({
    boardId,
    title,
    content,
    // Use custom status ID if available, status defaults to 'open' in schema
    statusId: defaultStatus?.id,
    memberId: memberRecord.id,
    authorName: session.user.name || 'User',
    authorEmail: session.user.email,
  })

  return NextResponse.json(post, { status: 201 })
}
