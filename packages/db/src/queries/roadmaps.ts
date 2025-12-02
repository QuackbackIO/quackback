import { eq, and } from 'drizzle-orm'
import { db } from '../tenant-context'
import { roadmaps } from '../schema/boards'
import { postRoadmaps } from '../schema/posts'
import type { NewRoadmap, Roadmap, RoadmapWithPosts } from '../types'

// Roadmap CRUD
export async function createRoadmap(data: NewRoadmap): Promise<Roadmap> {
  const [roadmap] = await db.insert(roadmaps).values(data).returning()
  return roadmap
}

export async function getRoadmapById(id: string): Promise<Roadmap | undefined> {
  return db.query.roadmaps.findFirst({
    where: eq(roadmaps.id, id),
  })
}

export async function getRoadmapBySlug(
  boardId: string,
  slug: string
): Promise<Roadmap | undefined> {
  return db.query.roadmaps.findFirst({
    where: and(eq(roadmaps.boardId, boardId), eq(roadmaps.slug, slug)),
  })
}

export async function getRoadmapsByBoard(boardId: string): Promise<Roadmap[]> {
  return db.query.roadmaps.findMany({
    where: eq(roadmaps.boardId, boardId),
    orderBy: (roadmaps, { asc }) => [asc(roadmaps.name)],
  })
}

export async function getPublicRoadmapsByBoard(boardId: string): Promise<Roadmap[]> {
  return db.query.roadmaps.findMany({
    where: and(eq(roadmaps.boardId, boardId), eq(roadmaps.isPublic, true)),
    orderBy: (roadmaps, { asc }) => [asc(roadmaps.name)],
  })
}

export async function getRoadmapWithPosts(id: string): Promise<RoadmapWithPosts | undefined> {
  const roadmap = await db.query.roadmaps.findFirst({
    where: eq(roadmaps.id, id),
    with: {
      postRoadmaps: {
        with: {
          post: true,
        },
      },
    },
  })

  if (!roadmap) return undefined

  return {
    ...roadmap,
    posts: roadmap.postRoadmaps.map((pr) => pr.post),
  }
}

export async function updateRoadmap(
  id: string,
  data: Partial<NewRoadmap>
): Promise<Roadmap | undefined> {
  const [updated] = await db
    .update(roadmaps)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(roadmaps.id, id))
    .returning()
  return updated
}

export async function deleteRoadmap(id: string): Promise<void> {
  await db.delete(roadmaps).where(eq(roadmaps.id, id))
}

// Post-Roadmap associations
export async function addPostToRoadmap(postId: string, roadmapId: string): Promise<void> {
  await db.insert(postRoadmaps).values({ postId, roadmapId }).onConflictDoNothing()
}

export async function removePostFromRoadmap(postId: string, roadmapId: string): Promise<void> {
  await db.delete(postRoadmaps).where(
    and(eq(postRoadmaps.postId, postId), eq(postRoadmaps.roadmapId, roadmapId))
  )
}

export async function setPostRoadmaps(postId: string, roadmapIds: string[]): Promise<void> {
  // Remove all existing associations
  await db.delete(postRoadmaps).where(eq(postRoadmaps.postId, postId))
  // Add new associations
  if (roadmapIds.length > 0) {
    await db.insert(postRoadmaps).values(
      roadmapIds.map((roadmapId) => ({ postId, roadmapId }))
    )
  }
}

export async function getPostRoadmaps(postId: string): Promise<Roadmap[]> {
  const associations = await db.query.postRoadmaps.findMany({
    where: eq(postRoadmaps.postId, postId),
    with: {
      roadmap: true,
    },
  })
  return associations.map((a) => a.roadmap)
}
