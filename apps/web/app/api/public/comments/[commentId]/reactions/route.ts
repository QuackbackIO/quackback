import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { toggleCommentReaction, getReactionEmojis } from '@quackback/db/queries/public'
import { getUserIdentifierFromRequest, setUserIdentifierCookie, hasUserIdentifierCookie } from '@/lib/user-identifier'

const reactionSchema = z.object({
  emoji: z.string().min(1),
})

interface RouteParams {
  params: Promise<{ commentId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { commentId } = await params

  // Parse and validate request body
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = reactionSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues[0]?.message || 'Invalid input' },
      { status: 400 }
    )
  }

  const { emoji } = result.data

  // Validate emoji is in allowed list
  const allowedEmojis = getReactionEmojis()
  if (!allowedEmojis.includes(emoji)) {
    return NextResponse.json(
      { error: 'Invalid emoji' },
      { status: 400 }
    )
  }

  // Get user identifier for tracking
  const userIdentifier = getUserIdentifierFromRequest(request)

  // Toggle the reaction
  const { added, reactions } = await toggleCommentReaction(commentId, userIdentifier, emoji)

  // Set the user identifier cookie if it's a new user
  const headers = new Headers()
  if (!hasUserIdentifierCookie(request)) {
    setUserIdentifierCookie(headers, userIdentifier)
  }

  return NextResponse.json({ added, reactions }, { headers })
}
