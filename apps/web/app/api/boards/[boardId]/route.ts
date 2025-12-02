import { NextRequest, NextResponse } from 'next/server'
import { db, boards, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const { boardId } = await params
    const body = await request.json()
    const { name, description, isPublic, settings, organizationId } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Get the board to verify ownership
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Verify board belongs to this organization
    if (board.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Merge settings with existing settings if provided
    let mergedSettings = board.settings
    if (settings !== undefined) {
      mergedSettings = {
        ...((board.settings as object) || {}),
        ...settings,
      }
    }

    // Update the board
    const [updatedBoard] = await db
      .update(boards)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isPublic !== undefined && { isPublic }),
        ...(settings !== undefined && { settings: mergedSettings }),
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
    const { boardId } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Get the board to verify ownership
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })

    if (!board) {
      return NextResponse.json({ error: 'Board not found' }, { status: 404 })
    }

    // Verify board belongs to this organization
    if (board.organizationId !== validation.organization.id) {
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
