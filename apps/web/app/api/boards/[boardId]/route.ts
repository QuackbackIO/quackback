import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, boards, eq } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { auth } from '@/lib/auth/index'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params
    const body = await request.json()
    const { name, description, isPublic } = body

    // Get the board to verify ownership
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Verify user has access to this organization
    const orgs = await auth.api.listOrganizations({
      headers: await headers(),
    })

    const hasAccess = orgs?.some((org) => org.id === board.organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Update the board
    const [updatedBoard] = await db
      .update(boards)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isPublic !== undefined && { isPublic }),
        updatedAt: new Date(),
      })
      .where(eq(boards.id, boardId))
      .returning()

    return NextResponse.json(updatedBoard)
  } catch (error) {
    console.error('Error updating board:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { boardId } = await params

    // Get the board to verify ownership
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Verify user has access to this organization
    const orgs = await auth.api.listOrganizations({
      headers: await headers(),
    })

    const hasAccess = orgs?.some((org) => org.id === board.organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete the board
    await db.delete(boards).where(eq(boards.id, boardId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting board:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
