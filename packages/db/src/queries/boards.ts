import { eq } from 'drizzle-orm'
import type { OrgId } from '@quackback/ids'
import { db } from '../tenant-context'
import { tags } from '../schema/boards'
import type { Tag } from '../types'

// Tag query
export async function getTagsByOrganization(organizationId: OrgId): Promise<Tag[]> {
  return db.query.tags.findMany({
    where: eq(tags.organizationId, organizationId),
    orderBy: (tags, { asc }) => [asc(tags.name)],
  })
}
