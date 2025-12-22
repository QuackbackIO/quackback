import { db } from '../client'
import type { Tag } from '../types'

/**
 * Get all tags, ordered by name
 */
export async function getTags(): Promise<Tag[]> {
  return db.query.tags.findMany({
    orderBy: (tags, { asc }) => [asc(tags.name)],
  })
}

// Backwards compatibility alias
export const getTagsByOrganization = getTags
