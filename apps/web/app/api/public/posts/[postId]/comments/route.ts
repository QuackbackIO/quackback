import { NextRequest, NextResponse } from 'next/server'
import {
  addPublicComment,
  getBoardByPostId,
  commentExistsForPost,
} from '@quackback/db/queries/public'
import { db, organization, eq, getMemberByUserAndOrg } from '@quackback/db'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
} from '@/lib/user-identifier'
import { commentSchema } from '@/lib/schemas/comments'
import { getSession } from '@/lib/auth/server'

interface RouteParams {
  params: Promise<{ postId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params

  // Get the board to find organization
  const board = await getBoardByPostId(postId)
  if (!board || !board.isPublic) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Get organization to check settings
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, board.organizationId),
  })

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  // Parse and validate request body
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = commentSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message || 'Invalid input' },
      { status: 400 }
    )
  }

  const { content, authorName, authorEmail, parentId } = result.data

  // Verify parent comment exists if provided (query DB directly for accuracy)
  if (parentId) {
    const parentExists = await commentExistsForPost(postId, parentId)
    if (!parentExists) {
      return NextResponse.json({ error: 'Parent comment not found' }, { status: 400 })
    }
  }

  // Check for authenticated user FIRST - team members can always comment
  const session = await getSession()

  if (session?.user) {
    // Authenticated user - get their member record for this organization
    const memberRecord = await getMemberByUserAndOrg(session.user.id, board.organizationId)

    if (memberRecord) {
      // Team members can always comment, regardless of portalPublicCommenting setting
      const comment = await addPublicComment(
        postId,
        content,
        session.user.name || authorName || null,
        session.user.email || authorEmail || null,
        parentId || undefined,
        memberRecord.id
      )
      return NextResponse.json(comment, { status: 201 })
    }
    // User is authenticated but not a member of this org - fall through to public user checks
  }

  // For non-team-members, check if public commenting is enabled
  if (!org.portalPublicCommenting) {
    return NextResponse.json({ error: 'Commenting is disabled' }, { status: 403 })
  }

  // Check if anonymous commenting is allowed
  if (org.portalRequireAuth) {
    return NextResponse.json(
      { error: 'Authentication required to comment. Please sign in or create an account.' },
      { status: 401 }
    )
  }

  // Add anonymous comment
  const comment = await addPublicComment(
    postId,
    content,
    authorName || null,
    authorEmail || null,
    parentId || undefined
  )

  // Set the user identifier cookie if it's a new user (use raw UUID for cookie)
  const headers = new Headers()
  if (!hasUserIdentifierCookie(request)) {
    const rawUuid = getRawUserIdentifierFromRequest(request)
    setUserIdentifierCookie(headers, rawUuid)
  }

  return NextResponse.json(comment, { status: 201, headers })
}
