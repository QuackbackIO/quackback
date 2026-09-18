import { eq } from '@/lib/server/db'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { ContentAudience } from './audience'

/** Use selection narrows retrieval; it never replaces source visibility. */
export function sourceUseFilter(
  source: { assistantCustomerUse: AnyPgColumn; assistantTeamUse: AnyPgColumn },
  ceiling: ContentAudience
) {
  return eq(ceiling === 'public' ? source.assistantCustomerUse : source.assistantTeamUse, true)
}
