import { NextResponse } from 'next/server'
import { db, boards, eq, and } from '@quackback/db'
import { withApiHandler, validateBody, successResponse } from '@/lib/api-handler'
import { createBoardSchema } from '@/lib/schemas/boards'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const { name, description, isPublic } = validateBody(createBoardSchema, body)

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

  return successResponse(newBoard, 201)
})

export const GET = withApiHandler(async (_request, { validation }) => {
  const orgBoards = await db.query.boards.findMany({
    where: eq(boards.organizationId, validation.organization.id),
    orderBy: (boards, { desc }) => [desc(boards.createdAt)],
  })

  return NextResponse.json(orgBoards)
})
