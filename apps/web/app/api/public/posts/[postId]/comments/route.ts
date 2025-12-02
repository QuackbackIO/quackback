import { NextRequest, NextResponse } from 'next/server'
import {
  addPublicComment,
  getBoardByPostId,
  commentExistsForPost,
} from '@quackback/db/queries/public'
import { getBoardSettings } from '@quackback/db/types'
import {
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
} from '@/lib/user-identifier'
import { commentSchema } from '@/lib/schemas/comments'

interface RouteParams {
  params: Promise<{ postId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params

  // Get the board to check if commenting is allowed
  const board = await getBoardByPostId(postId)
  if (!board || !board.isPublic) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Check if public commenting is enabled for this board
  const settings = getBoardSettings(board)
  if (!settings.publicCommenting) {
    return NextResponse.json({ error: 'Commenting is disabled for this board' }, { status: 403 })
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

  // Add the comment (public comments use authorName/authorEmail, not memberId)
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
