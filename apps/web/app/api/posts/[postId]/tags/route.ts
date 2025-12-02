import { NextRequest, NextResponse } from 'next/server'
import { getPostWithDetails, setPostTags } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const { postId } = await params
    const body = await request.json()
    const { organizationId, tagIds } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'tagIds must be an array' }, { status: 400 })
    }

    // Get the post to verify it belongs to this org
    const existingPost = await getPostWithDetails(postId)
    if (!existingPost) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    if (existingPost.board.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Update tags
    await setPostTags(postId, tagIds)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating post tags:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
