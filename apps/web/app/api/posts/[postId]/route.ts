import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { getPostService, getMemberService } from '@/lib/services'
import { buildServiceContext, type CommentTreeNode, type PostError } from '@quackback/domain'

/**
 * Recursively collect all member IDs from comments and their nested replies
 */
function collectCommentMemberIds(comments: CommentTreeNode[]): string[] {
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

/**
 * Map PostError codes to HTTP status codes
 */
function getHttpStatusFromError(error: PostError): number {
  switch (error.code) {
    case 'POST_NOT_FOUND':
      return 404
    case 'BOARD_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
      return 400
    default:
      return 500
  }
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

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Get post with details using PostService
    const postResult = await getPostService().getPostWithDetails(postId, ctx)

    // Handle Result type
    if (!postResult.success) {
      const status = getHttpStatusFromError(postResult.error)
      return NextResponse.json({ error: postResult.error.message }, { status })
    }

    const post = postResult.value

    // Get comments with reactions in nested format
    // Use member ID as identifier to track which reactions belong to current user
    const commentsResult = await getPostService().getCommentsWithReplies(
      postId,
      `member:${validation.member.id}`,
      ctx
    )

    // Handle Result type
    if (!commentsResult.success) {
      const status = getHttpStatusFromError(commentsResult.error)
      return NextResponse.json({ error: commentsResult.error.message }, { status })
    }

    const commentsWithReplies = commentsResult.value

    // Collect member IDs from post author and all comments for avatar lookup
    const memberIds: string[] = []
    if (post.memberId) memberIds.push(post.memberId)
    memberIds.push(...collectCommentMemberIds(commentsWithReplies))

    // Fetch avatar URLs for all members
    const avatarMap = await getBulkMemberAvatarData(memberIds)

    // Transform tags and official response for response format
    const transformedPost = {
      ...post,
      tags: post.tags,
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

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Build update input
    const updateInput: {
      status?: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
      ownerId?: string | null
      ownerMemberId?: string | null
      officialResponse?: string | null
      officialResponseMemberId?: string | null
      officialResponseAuthorName?: string | null
    } = {}

    if (status !== undefined) updateInput.status = status
    if (ownerId !== undefined) {
      updateInput.ownerId = ownerId
      // Look up ownerMemberId from ownerId (user ID -> member ID for this org)
      if (ownerId) {
        const ownerMemberResult = await getMemberService().getMemberByUserAndOrg(
          ownerId,
          validation.organization.id
        )
        const ownerMember = ownerMemberResult.success ? ownerMemberResult.value : null
        updateInput.ownerMemberId = ownerMember?.id ?? null
      } else {
        updateInput.ownerMemberId = null
      }
    }

    // Handle official response update
    if (body.officialResponse !== undefined) {
      if (body.officialResponse === null || body.officialResponse === '') {
        // Clear the official response
        updateInput.officialResponse = null
        updateInput.officialResponseMemberId = null
        updateInput.officialResponseAuthorName = null
      } else {
        // Set or update official response with member-scoped identity
        updateInput.officialResponse = body.officialResponse
        updateInput.officialResponseMemberId = validation.member.id
        updateInput.officialResponseAuthorName = validation.user.name || validation.user.email
      }
    }

    // Update post using PostService
    const result = await getPostService().updatePost(postId, updateInput, ctx)

    // Handle Result type
    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error updating post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
