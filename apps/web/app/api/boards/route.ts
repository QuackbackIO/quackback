import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, boards, eq, and } from '@quackback/db'
import { getSession } from '@/lib/auth/server'
import { auth } from '@/lib/auth/index'

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
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { name, description, organizationId, isPublic = true } = body

    if (!name || !organizationId) {
      return NextResponse.json({ error: 'Name and organizationId are required' }, { status: 400 })
    }

    // Verify user has access to this organization
    const orgs = await auth.api.listOrganizations({
      headers: await headers(),
    })

    const hasAccess = orgs?.some((org) => org.id === organizationId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Generate unique slug
    let slug = slugify(name)
    let counter = 0
    let isUnique = false

    while (!isUnique) {
      const existingBoard = await db.query.boards.findFirst({
        where: and(eq(boards.organizationId, organizationId), eq(boards.slug, slug)),
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
        organizationId,
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
    const session = await getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    const orgBoards = await db.query.boards.findMany({
      where: eq(boards.organizationId, organizationId),
      orderBy: (boards, { desc }) => [desc(boards.createdAt)],
    })

    return NextResponse.json(orgBoards)
  } catch (error) {
    console.error('Error fetching boards:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
