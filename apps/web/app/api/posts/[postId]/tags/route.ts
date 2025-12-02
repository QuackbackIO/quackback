import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPostWithDetails, setPostTags } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { auth } from '@/lib/auth/index'

export async function PUT(
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
    const { organizationId, tagIds } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }

    if (!Array.isArray(tagIds)) {
      return NextResponse.json({ error: 'tagIds must be an array' }, { status: 400 })
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

    // Update tags
    await setPostTags(postId, tagIds)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating post tags:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
