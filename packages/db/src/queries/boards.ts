import { eq, and } from 'drizzle-orm'
import { db } from '../tenant-context'
import { boards, tags } from '../schema/boards'
import type { NewBoard, Board, NewTag, Tag } from '../types'

// Board queries
export async function createBoard(data: NewBoard): Promise<Board> {
  const [board] = await db.insert(boards).values(data).returning()
  return board
}

export async function getBoardById(id: string): Promise<Board | undefined> {
  return db.query.boards.findFirst({
    where: eq(boards.id, id),
  })
}

export async function getBoardBySlug(
  organizationId: string,
  slug: string
): Promise<Board | undefined> {
  return db.query.boards.findFirst({
    where: and(eq(boards.organizationId, organizationId), eq(boards.slug, slug)),
  })
}

export async function getBoardsByOrganization(organizationId: string): Promise<Board[]> {
  return db.query.boards.findMany({
    where: eq(boards.organizationId, organizationId),
    orderBy: (boards, { asc }) => [asc(boards.name)],
  })
}

export async function getPublicBoardsByOrganization(organizationId: string): Promise<Board[]> {
  return db.query.boards.findMany({
    where: and(eq(boards.organizationId, organizationId), eq(boards.isPublic, true)),
    orderBy: (boards, { asc }) => [asc(boards.name)],
  })
}

export async function updateBoard(
  id: string,
  data: Partial<NewBoard>
): Promise<Board | undefined> {
  const [updated] = await db
    .update(boards)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(boards.id, id))
    .returning()
  return updated
}

export async function deleteBoard(id: string): Promise<void> {
  await db.delete(boards).where(eq(boards.id, id))
}

// Tag queries
export async function createTag(data: NewTag): Promise<Tag> {
  const [tag] = await db.insert(tags).values(data).returning()
  return tag
}

export async function getTagsByOrganization(organizationId: string): Promise<Tag[]> {
  return db.query.tags.findMany({
    where: eq(tags.organizationId, organizationId),
    orderBy: (tags, { asc }) => [asc(tags.name)],
  })
}

export async function deleteTag(id: string): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id))
}
