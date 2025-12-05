import { NextRequest, NextResponse } from 'next/server'
import {
  getPostWithDetails,
  getCommentsWithReplies,
  updatePost,
  db,
  member,
  eq,
  and,
  type CommentWithRepliesAndReactions,
} from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getBulkMemberAvatarData } from '@/lib/avatar'

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: CommentWithRepliesAndReactions[]): string[] {
  const memberIds: string[] = []
  for (const comment of comments) {
    if (comment.memberId) {
      memberIds.push(comment.memberId)
    }
    if (comment.replies.length > 0) {
      memberIds.push(...collectCommentMemberIds(comment.replies))
    }
  }
  return memberIds
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const post = await getPostWithDetails(postId)

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // Verify the post belongs to a board in this organization
    if (post.board.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get comments with reactions in nested format
    // Use member ID as identifier to track which reactions belong to current user
    const commentsWithReplies = await getCommentsWithReplies(
      postId,
      `member:${validation.member.id}`
    )

    // Collect member IDs from post author and all comments for avatar lookup
    const memberIds: string[] = []
    if (post.memberId) memberIds.push(post.memberId)
    memberIds.push(...collectCommentMemberIds(commentsWithReplies))

    // Fetch avatar URLs for all members
    const avatarMap = await getBulkMemberAvatarData(memberIds)

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
      // Include avatar URLs map for SSR-like rendering
      avatarUrls: Object.fromEntries(avatarMap),
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
    const { postId } = await params
    const body = await request.json()
    const { organizationId, status, ownerId } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Get the post to verify it belongs to this org
    const existingPost = await getPostWithDetails(postId)
    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (existingPost.board.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Build update data
    const updateData: {
      status?: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
      ownerId?: string | null
      ownerMemberId?: string | null
      officialResponse?: string | null
      officialResponseAuthorId?: string | null
      officialResponseMemberId?: string | null
      officialResponseAuthorName?: string | null
      officialResponseAt?: Date | null
    } = {}
    if (status !== undefined) updateData.status = status
    if (ownerId !== undefined) {
      updateData.ownerId = ownerId
      // Look up ownerMemberId from ownerId (user ID -> member ID for this org)
      if (ownerId) {
        const ownerMember = await db.query.member.findFirst({
          where: and(
            eq(member.userId, ownerId),
            eq(member.organizationId, validation.organization.id)
          ),
        })
        updateData.ownerMemberId = ownerMember?.id ?? null
      } else {
        updateData.ownerMemberId = null
      }
    }

    // Handle official response update
    if (body.officialResponse !== undefined) {
      if (body.officialResponse === null || body.officialResponse === '') {
        // Clear the official response
        updateData.officialResponse = null
        updateData.officialResponseAuthorId = null
        updateData.officialResponseMemberId = null
        updateData.officialResponseAuthorName = null
        updateData.officialResponseAt = null
      } else {
        // Set or update official response with member-scoped identity
        updateData.officialResponse = body.officialResponse
        updateData.officialResponseAuthorId = validation.user.id
        updateData.officialResponseMemberId = validation.member.id
        updateData.officialResponseAuthorName = validation.user.name || validation.user.email
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
