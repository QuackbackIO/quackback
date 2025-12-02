import { NextRequest, NextResponse } from 'next/server'
import { togglePublicVote, getBoardByPostId } from '@quackback/db/queries/public'
import { getBoardSettings } from '@quackback/db/types'
import {
  getUserIdentifierFromRequest,
  getRawUserIdentifierFromRequest,
  setUserIdentifierCookie,
  hasUserIdentifierCookie,
} from '@/lib/user-identifier'

interface RouteParams {
  params: Promise<{ postId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { postId } = await params

  // Get the board to check if voting is allowed
  const board = await getBoardByPostId(postId)
  if (!board || !board.isPublic) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  // Check if public voting is enabled for this board
  const settings = getBoardSettings(board)
  if (!settings.publicVoting) {
    return NextResponse.json({ error: 'Voting is disabled for this board' }, { status: 403 })
  }

  // Get or create user identifier (uses anon:{uuid} format for public users)
  const userIdentifier = getUserIdentifierFromRequest(request)

  // Toggle the vote
  const result = await togglePublicVote(postId, userIdentifier)

  // Set the user identifier cookie if it's a new user (use raw UUID for cookie)
  const headers = new Headers()
  if (!hasUserIdentifierCookie(request)) {
    const rawUuid = getRawUserIdentifierFromRequest(request)
    setUserIdentifierCookie(headers, rawUuid)
  }

  return NextResponse.json(result, { headers })
}
