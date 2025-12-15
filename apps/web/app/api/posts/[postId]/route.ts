import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getBulkMemberAvatarData } from '@/lib/avatar'
import { getMemberIdentifier } from '@/lib/user-identifier'
import { getPostService, getMemberService, getRoadmapService } from '@/lib/services'
import { buildServiceContext, type CommentTreeNode, type PostError } from '@quackback/domain'
import { isValidTypeId, type PostId, type MemberId, type OrgId } from '@quackback/ids'

/**
 * Recursively collect all member IDs from comments and their nested replies
 * Note: Service returns TypeID format strings, we cast them to MemberId
 */
function collectCommentMemberIds(comments: CommentTreeNode[]): MemberId[] {
  const memberIds: MemberId[] = []
  for (const comment of comments) {
    if (comment.memberId) {
      memberIds.push(comment.memberId as MemberId)
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
    const { postId: postIdParam } = await params
    const { searchParams } = new URL(request.url)
    const organizationIdParam = searchParams.get('organizationId')

    // Validate TypeID formats
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    let organizationId: OrgId | null = null
    if (organizationIdParam) {
      if (!isValidTypeId(organizationIdParam, 'org')) {
        return NextResponse.json({ error: 'Invalid organization ID format' }, { status: 400 })
      }
      organizationId = organizationIdParam as OrgId
    }

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
    // Note: Service returns TypeID format strings, we cast them to MemberId
    const memberIds: MemberId[] = []
    if (post.memberId) memberIds.push(post.memberId as MemberId)
    memberIds.push(...collectCommentMemberIds(commentsWithReplies))

    // Fetch avatar URLs for all members
    const avatarMap = await getBulkMemberAvatarData(memberIds)

    // Check if current user has voted on this post
    const userIdentifier = getMemberIdentifier(validation.member.id)
    const hasVotedResult = await getPostService().hasUserVotedOnPost(postId, userIdentifier)
    const hasVoted = hasVotedResult.success ? hasVotedResult.value : false

    // Get roadmap IDs this post belongs to
    const roadmapsResult = await getRoadmapService().getPostRoadmaps(postId, ctx)
    const roadmapIds = roadmapsResult.success ? roadmapsResult.value.map((r) => r.id) : []

    // Post and comments are already in TypeID format from the service layer
    const responseData = {
      ...post,
      comments: commentsWithReplies,
      hasVoted,
      roadmapIds,
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

    return NextResponse.json(responseData)
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
    const { postId: postIdParam } = await params
    const body = await request.json()
    const { organizationId, status, ownerId, title, content, contentJson } = body

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Build update input
    const updateInput: {
      title?: string
      content?: string
      contentJson?: unknown
      status?: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
      ownerId?: string | null
      ownerMemberId?: MemberId | null
      officialResponse?: string | null
      officialResponseMemberId?: MemberId | null
      officialResponseAuthorName?: string | null
    } = {}

    // Handle title and content updates
    if (title !== undefined) updateInput.title = title
    if (content !== undefined) updateInput.content = content
    if (contentJson !== undefined) updateInput.contentJson = contentJson

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
        // Convert raw member ID to MemberId format
        updateInput.ownerMemberId = ownerMember ? ownerMember.id : null
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
        // Convert raw member ID to MemberId format
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

    // Post is already in TypeID format from the service layer
    return NextResponse.json(result.value)
  } catch (error) {
    console.error('Error updating post:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
