/**
 * Plan caps for a CSV import run. The commit path inserts boards and posts
 * directly (no per-row events), so it never passes through the board and post
 * services' count gates; this check applies the same `maxBoards` / `maxPosts`
 * caps to the whole run before the first write, so a refused run leaves
 * nothing half-imported.
 */
import {
  and,
  boards,
  db,
  eq,
  inArray,
  isNull,
  postExternalLinks,
  posts,
  sql,
} from '@/lib/server/db'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { notTestPrincipal } from '@/lib/server/test-data'
import type { ImportInput } from './types'
import { ImportUserResolver } from './user-resolver'
import { BATCH_SIZE, IMPORT_LINK_TYPE, loadRowContext, resolveRows } from './import-row-resolver'

function fitMessage(friendly: string, max: number, current: number, adding: number): string {
  const room = Math.max(0, max - current)
  return (
    `This import would add ${adding} ${friendly}, but your plan allows ${max} and you have ` +
    `${current}. Only ${room} more fit. Reduce the import or upgrade your plan.`
  )
}

/**
 * Throws a TierLimitError when the run would create more boards or posts than
 * the plan allows. Rows that update a previously imported post do not count.
 * Does nothing when both limits are unlimited.
 */
export async function assertImportWithinPlanLimits(
  data: ImportInput,
  rows: Record<string, string>[]
): Promise<void> {
  const limits = await getTierLimits()
  if (limits.maxBoards === null && limits.maxPosts === null) return

  const ctx = await loadRowContext()
  const userResolver = new ImportUserResolver()
  const tagsToCreate = new Set<string>()
  const statusesToCreate = new Map<string, string>()
  const boardsToCreate = new Map<string, string>()
  const sourceIds: string[] = []
  let validCount = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { validRows } = await resolveRows(
      rows.slice(i, i + BATCH_SIZE),
      data.boardId,
      i,
      userResolver,
      ctx,
      tagsToCreate,
      statusesToCreate,
      boardsToCreate
    )
    validCount += validRows.length
    for (const { row } of validRows) if (row.sourceId) sourceIds.push(row.sourceId)
  }

  if (limits.maxBoards !== null && boardsToCreate.size > 0) {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(boards)
      .where(isNull(boards.deletedAt))
    const current = row?.count ?? 0
    if (current + boardsToCreate.size > limits.maxBoards) {
      throw new TierLimitError({
        limit: 'maxBoards',
        current,
        max: limits.maxBoards,
        message: fitMessage('boards', limits.maxBoards, current, boardsToCreate.size),
      })
    }
  }

  if (limits.maxPosts !== null && validCount > 0) {
    const linked =
      sourceIds.length > 0
        ? await db.query.postExternalLinks.findMany({
            where: and(
              eq(postExternalLinks.integrationType, IMPORT_LINK_TYPE),
              inArray(postExternalLinks.externalId, sourceIds)
            ),
          })
        : []
    const updating = new Set(linked.map((l) => l.externalId))
    const adding = validCount - sourceIds.filter((id) => updating.has(id)).length
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(isNull(posts.deletedAt), notTestPrincipal(posts.principalId)))
    const current = row?.count ?? 0
    if (adding > 0 && current + adding > limits.maxPosts) {
      throw new TierLimitError({
        limit: 'maxPosts',
        current,
        max: limits.maxPosts,
        message: fitMessage('posts', limits.maxPosts, current, adding),
      })
    }
  }
}
