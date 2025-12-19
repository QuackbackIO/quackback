import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess } from '@/lib/tenant'
import { getPostService } from '@/lib/services'
import { buildServiceContext, buildPostStatusChangedEvent } from '@quackback/domain'
import type { PostError } from '@quackback/domain'
import { isValidTypeId, type PostId, type StatusId } from '@quackback/ids'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getJobAdapter, isCloudflareWorker } from '@quackback/jobs'

/**
 * Map PostError codes to HTTP status codes
 */
function getHttpStatusFromError(error: PostError): number {
  switch (error.code) {
    case 'POST_NOT_FOUND':
      return 404
    case 'STATUS_NOT_FOUND':
      return 404
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
      return 400
    default:
      return 500
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId: postIdParam } = await params
    const body = await request.json()
    const { workspaceId, statusId: statusIdParam } = body

    // Validate TypeID format
    if (!isValidTypeId(postIdParam, 'post')) {
      return NextResponse.json({ error: 'Invalid post ID format' }, { status: 400 })
    }
    const postId = postIdParam as PostId

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(workspaceId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Validate statusId is provided and valid
    if (!statusIdParam) {
      return NextResponse.json({ error: 'statusId is required' }, { status: 400 })
    }
    if (!isValidTypeId(statusIdParam, 'status')) {
      return NextResponse.json({ error: 'Invalid status ID format' }, { status: 400 })
    }
    const statusId = statusIdParam as StatusId

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Get PostService and change status
    const postService = getPostService()
    const result = await postService.changeStatus(postId, statusId, ctx)

    // Map Result to HTTP response
    if (!result.success) {
      const status = getHttpStatusFromError(result.error)
      return NextResponse.json({ error: result.error.message }, { status })
    }

    // Trigger EventWorkflow for integrations and notifications
    const { boardSlug, previousStatus, newStatus, ...post } = result.value
    const eventData = buildPostStatusChangedEvent(
      ctx.workspaceId,
      { type: 'user', userId: ctx.userId, email: ctx.userEmail },
      { id: post.id, title: post.title, boardSlug },
      previousStatus,
      newStatus
    )
    const env = isCloudflareWorker() ? getCloudflareContext().env : undefined
    const jobAdapter = getJobAdapter(env)
    await jobAdapter.addEventJob(eventData)

    // Response is already in TypeID format from service layer
    return NextResponse.json(post)
  } catch (error) {
    console.error('Error changing post status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
