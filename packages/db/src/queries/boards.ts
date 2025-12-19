import { eq } from 'drizzle-orm'
import type { WorkspaceId } from '@quackback/ids'
import { db } from '../tenant-context'
import { tags } from '../schema/boards'
import type { Tag } from '../types'

// Tag query
export async function getTagsByOrganization(organizationId: WorkspaceId): Promise<Tag[]> {
  return db.query.tags.findMany({
    where: eq(tags.workspaceId, organizationId),
    orderBy: (tags, { asc }) => [asc(tags.name)],
  })
}
