import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPostWithDetails, getCommentsWithReplies, updatePost } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { auth } from '@/lib/auth/index'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { postId } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Verify user has access to this organization
    const orgs = await auth.api.listOrganizations({
      headers: await headers(),
    })

    const hasAccess = orgs?.some((org) => org.id === organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const post = await getPostWithDetails(postId)

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Verify the post belongs to a board in this organization
    if (post.board.organizationId !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get comments with reactions in nested format
    // Use user ID as identifier to track which reactions belong to current user
    const commentsWithReplies = await getCommentsWithReplies(postId, session.user.id)

    // Transform tags from junction table format and official response
    const transformedPost = {
      ...post,
      tags: post.tags.map((pt: { tag: { id: string; name: string; color: string } }) => pt.tag),
      comments: commentsWithReplies,
      officialResponse: post.officialResponse
        ? {
            content: post.officialResponse,
            authorName: post.officialResponseAuthorName,
            respondedAt: post.officialResponseAt,
          }
        : null,
    }

    return NextResponse.json(transformedPost)
  } catch (error) {
    console.error('Error fetching post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { postId } = await params
    const body = await request.json()
    const { organizationId, status, ownerId } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    // Verify user has access to this organization
    const orgs = await auth.api.listOrganizations({
      headers: await headers(),
    })

    const hasAccess = orgs?.some((org) => org.id === organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get the post to verify it belongs to this org
    const existingPost = await getPostWithDetails(postId)
    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (existingPost.board.organizationId !== organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build update data
    const updateData: {
      status?: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
      ownerId?: string | null
      officialResponse?: string | null
      officialResponseAuthorId?: string | null
      officialResponseAuthorName?: string | null
      officialResponseAt?: Date | null
    } = {}
    if (status !== undefined) updateData.status = status
    if (ownerId !== undefined) updateData.ownerId = ownerId

    // Handle official response update
    if (body.officialResponse !== undefined) {
      if (body.officialResponse === null || body.officialResponse === '') {
        // Clear the official response
        updateData.officialResponse = null
        updateData.officialResponseAuthorId = null
        updateData.officialResponseAuthorName = null
        updateData.officialResponseAt = null
      } else {
        // Set or update official response
        updateData.officialResponse = body.officialResponse
        updateData.officialResponseAuthorId = session.user.id
        updateData.officialResponseAuthorName = session.user.name || session.user.email
        updateData.officialResponseAt = new Date()
      }
    }

    const updatedPost = await updatePost(postId, updateData)

    return NextResponse.json(updatedPost)
  } catch (error) {
    console.error('Error updating post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
