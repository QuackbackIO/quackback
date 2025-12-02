import { eq, and, isNotNull, desc } from 'drizzle-orm'
import { db } from '../tenant-context'
import { changelogEntries } from '../schema/changelog'
import type { NewChangelogEntry, ChangelogEntry } from '../types'

export async function createChangelogEntry(data: NewChangelogEntry): Promise<ChangelogEntry> {
  const [entry] = await db.insert(changelogEntries).values(data).returning()
  return entry
}

export async function getChangelogEntryById(id: string): Promise<ChangelogEntry | undefined> {
  return db.query.changelogEntries.findFirst({
    where: eq(changelogEntries.id, id),
  })
}

export async function getChangelogEntriesByBoard(boardId: string): Promise<ChangelogEntry[]> {
  return db.query.changelogEntries.findMany({
    where: eq(changelogEntries.boardId, boardId),
    orderBy: (entries, { desc }) => [desc(entries.createdAt)],
  })
}

export async function getPublishedChangelogEntries(boardId: string): Promise<ChangelogEntry[]> {
  return db.query.changelogEntries.findMany({
    where: and(
      eq(changelogEntries.boardId, boardId),
      isNotNull(changelogEntries.publishedAt)
    ),
    orderBy: desc(changelogEntries.publishedAt),
  })
}

export async function updateChangelogEntry(
  id: string,
  data: Partial<NewChangelogEntry>
): Promise<ChangelogEntry | undefined> {
  const [updated] = await db
    .update(changelogEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(changelogEntries.id, id))
    .returning()
  return updated
}

export async function publishChangelogEntry(id: string): Promise<ChangelogEntry | undefined> {
  return updateChangelogEntry(id, { publishedAt: new Date() })
}

export async function unpublishChangelogEntry(id: string): Promise<ChangelogEntry | undefined> {
  const [updated] = await db
    .update(changelogEntries)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(eq(changelogEntries.id, id))
    .returning()
  return updated
}

export async function deleteChangelogEntry(id: string): Promise<void> {
  await db.delete(changelogEntries).where(eq(changelogEntries.id, id))
}
