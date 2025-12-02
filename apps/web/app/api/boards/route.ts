import { NextRequest, NextResponse } from 'next/server'
import { db, boards, eq, and } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { createBoardSchema } from '@/lib/schemas/boards'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Validate the board data with Zod schema
    const result = createBoardSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }

    const { name, description, isPublic } = result.data

    // Generate unique slug
    let slug = slugify(name)
    let counter = 0
    let isUnique = false

    while (!isUnique) {
      const existingBoard = await db.query.boards.findFirst({
        where: and(eq(boards.organizationId, validation.organization.id), eq(boards.slug, slug)),
      })

      if (!existingBoard) {
        isUnique = true
      } else {
        counter++
        slug = `${slugify(name)}-${counter}`
      }
    }

    // Create the board
    const [newBoard] = await db
      .insert(boards)
      .values({
        organizationId: validation.organization.id,
        name,
        slug,
        description: description || null,
        isPublic,
        settings: {},
      })
      .returning()

    return NextResponse.json(newBoard, { status: 201 })
  } catch (error) {
    console.error('Error creating board:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const orgBoards = await db.query.boards.findMany({
      where: eq(boards.organizationId, validation.organization.id),
      orderBy: (boards, { desc }) => [desc(boards.createdAt)],
    })

    return NextResponse.json(orgBoards)
  } catch (error) {
    console.error('Error fetching boards:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
