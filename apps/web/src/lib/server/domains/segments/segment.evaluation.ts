import { db, eq, and, inArray, isNull, sql, segments, userSegments } from '@/lib/server/db'
import type { SegmentId, PrincipalId } from '@quackback/ids'
import { fromUuid } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import type { EvaluationResult } from './segment.types'
import type { SegmentRules, SegmentCondition } from '@/lib/server/db'
import { getSegment } from './segment.service'

/** SQL comparison operators for rule conditions */
const OPERATOR_SQL: Record<string, string> = {
  eq: '=',
  neq: '!=',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
}

/** Activity count subquery for post_count, vote_count, comment_count */
function activityCountSql(table: string, hasSoftDelete: boolean): ReturnType<typeof sql> {
  const whereClause = hasSoftDelete
    ? sql.raw(`WHERE ${table}.principal_id = p.id AND ${table}.deleted_at IS NULL`)
    : sql.raw(`WHERE ${table}.principal_id = p.id`)
  return sql`(SELECT COUNT(*)::int FROM ${sql.raw(table)} ${whereClause})`
}

/** Apply string operators (contains, starts_with, ends_with) to a SQL expression */
function stringOperatorSql(
  field: ReturnType<typeof sql>,
  operator: string,
  value: string | number | boolean | (string | number)[] | undefined
): ReturnType<typeof sql> | null {
  const str = String(value)
  if (operator === 'contains') return sql`${field} ILIKE ${'%' + str + '%'}`
  if (operator === 'starts_with') return sql`${field} ILIKE ${str + '%'}`
  if (operator === 'ends_with') return sql`${field} ILIKE ${'%' + str}`
  return null
}

/**
 * Build a SQL condition fragment for a single rule condition.
 * Returns a SQL template or null if the condition is unsupported.
 */
function buildConditionSql(condition: SegmentCondition): ReturnType<typeof sql> | null {
  const { attribute, operator, value } = condition

  // Handle is_set / is_not_set
  if (operator === 'is_set' || operator === 'is_not_set') {
    const isSet = operator === 'is_set'
    switch (attribute) {
      case 'email_domain':
        return isSet ? sql`u.email IS NOT NULL` : sql`u.email IS NULL`
      case 'email_verified':
        return isSet ? sql`u.email_verified = true` : sql`u.email_verified = false`
      case 'plan':
        return isSet
          ? sql`(u.metadata::jsonb->>'plan') IS NOT NULL`
          : sql`(u.metadata::jsonb->>'plan') IS NULL`
      case 'metadata_key': {
        const key = condition.metadataKey
        if (!key) return null
        return isSet
          ? sql`(u.metadata::jsonb->>${key}) IS NOT NULL`
          : sql`(u.metadata::jsonb->>${key}) IS NULL`
      }
      case 'post_count':
        return sql`${activityCountSql('posts', true)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      case 'vote_count':
        return sql`${activityCountSql('votes', false)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      case 'comment_count':
        return sql`${activityCountSql('comments', true)} ${sql.raw(isSet ? '> 0' : '= 0')}`
      default:
        return null
    }
  }

  // Handle 'in' operator — value must be an array
  if (operator === 'in') {
    const values = Array.isArray(value) ? value : []
    if (values.length === 0) return null
    const placeholders = sql.join(
      values.map((v) => sql`${String(v)}`),
      sql`, `
    )

    switch (attribute) {
      case 'email_domain': {
        const domains = values.map((v) => sql`${String(v).replace(/^@/, '').toLowerCase()}`)
        return sql`LOWER(SPLIT_PART(u.email, '@', 2)) IN (${sql.join(domains, sql`, `)})`
      }
      case 'plan':
        return sql`(u.metadata::jsonb->>'plan') IN (${placeholders})`
      case 'metadata_key': {
        const key = condition.metadataKey
        if (!key) return null
        return sql`(u.metadata::jsonb->>${key}) IN (${placeholders})`
      }
      default:
        return null
    }
  }

  switch (attribute) {
    case 'email_verified':
      return sql`u.email_verified = ${Boolean(value)}`

    case 'email_domain': {
      const domain = String(value).replace(/^@/, '')
      if (operator === 'eq') return sql`u.email ILIKE ${'%@' + domain}`
      if (operator === 'neq') return sql`u.email NOT ILIKE ${'%@' + domain}`
      if (operator === 'ends_with') return sql`u.email ILIKE ${'%' + domain}`
      return null
    }

    case 'created_at_days_ago': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`(NOW() - p.created_at) ${sql.raw(sqlOp)} (${Number(value)} * INTERVAL '1 day')`
    }

    case 'plan': {
      const field = sql`(u.metadata::jsonb->>'plan')`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'metadata_key': {
      const key = condition.metadataKey
      if (!key) return null
      const field = sql`(u.metadata::jsonb->>${key})`
      const strResult = stringOperatorSql(field, operator, value)
      if (strResult) return strResult
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      if (typeof value === 'number') {
        return sql`${field}::numeric ${sql.raw(sqlOp)} ${value}`
      }
      return sql`${field} ${sql.raw(sqlOp)} ${String(value)}`
    }

    case 'post_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('posts', true)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'vote_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('votes', false)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    case 'comment_count': {
      const sqlOp = OPERATOR_SQL[operator]
      if (!sqlOp) return null
      return sql`${activityCountSql('comments', true)} ${sql.raw(sqlOp)} ${Number(value)}`
    }

    default:
      return null
  }
}

/**
 * Evaluate a dynamic segment's rules and return the set of matching principal IDs.
 * Translates rules to SQL — does not load users into memory.
 */
async function resolveMatchingPrincipals(rules: SegmentRules): Promise<string[]> {
  const conditionSqls = rules.conditions
    .map(buildConditionSql)
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (conditionSqls.length === 0) return []

  const combinedWhere =
    rules.match === 'all'
      ? conditionSqls.reduce((acc, c) => sql`${acc} AND ${c}`)
      : conditionSqls.reduce((acc, c) => sql`${acc} OR ${c}`)

  const rows = await db.execute(sql`
    SELECT p.id
    FROM principal p
    INNER JOIN "user" u ON u.id = p.user_id
    WHERE p.role = 'user'
      AND p.user_id IS NOT NULL
      AND (${combinedWhere})
  `)

  // db.execute() returns raw UUIDs from PostgreSQL, but the rest of the
  // evaluation logic uses Drizzle query builder which converts UUIDs to TypeIDs
  // via the typeIdColumn custom type. We must convert here to ensure the
  // Set-based diff in evaluateDynamicSegment compares like with like.
  return (rows as unknown as Array<{ id: string }>).map(
    (r) => fromUuid('principal', r.id) as string
  )
}

/**
 * Evaluate a single dynamic segment and sync the user_segments table.
 * Adds new matches, removes stale members.
 */
export async function evaluateDynamicSegment(segmentId: SegmentId): Promise<EvaluationResult> {
  const segment = await getSegment(segmentId)
  if (!segment) {
    throw new NotFoundError('SEGMENT_NOT_FOUND', `Segment ${segmentId} not found`)
  }
  if (segment.type !== 'dynamic') {
    throw new ValidationError('SEGMENT_TYPE_ERROR', 'Segment is not dynamic')
  }
  if (!segment.rules || !segment.rules.conditions?.length) {
    const deleted = await db
      .delete(userSegments)
      .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))
      .returning({ principalId: userSegments.principalId })
    const removedIds = deleted.map((row) => row.principalId as PrincipalId)
    if (removedIds.length > 0) {
      import('@/lib/server/integrations/user-sync-notify')
        .then(({ notifyUserSyncIntegrations }) =>
          notifyUserSyncIntegrations(segment.name, [], removedIds)
        )
        .catch((err) => console.error('[UserSync] notifyUserSyncIntegrations failed:', err))
    }
    return { segmentId, added: 0, removed: deleted.length }
  }

  const currentMembers = await db
    .select({ principalId: userSegments.principalId })
    .from(userSegments)
    .where(and(eq(userSegments.segmentId, segmentId), eq(userSegments.addedBy, 'dynamic')))

  const currentIds = new Set<string>(currentMembers.map((r) => r.principalId))

  const matchingIds = await resolveMatchingPrincipals(segment.rules)
  const matchingSet = new Set(matchingIds)

  const toAdd = matchingIds.filter((id) => !currentIds.has(id)) as PrincipalId[]
  const toRemove = [...currentIds].filter((id) => !matchingSet.has(id)) as PrincipalId[]

  await db.transaction(async (tx) => {
    if (toAdd.length > 0) {
      await tx
        .insert(userSegments)
        .values(
          toAdd.map((pid) => ({
            principalId: pid,
            segmentId,
            addedBy: 'dynamic' as const,
          }))
        )
        .onConflictDoNothing()
    }
    if (toRemove.length > 0) {
      await tx
        .delete(userSegments)
        .where(
          and(eq(userSegments.segmentId, segmentId), inArray(userSegments.principalId, toRemove))
        )
    }
  })

  if (toAdd.length > 0 || toRemove.length > 0) {
    import('@/lib/server/integrations/user-sync-notify')
      .then(({ notifyUserSyncIntegrations }) =>
        notifyUserSyncIntegrations(segment.name, toAdd, toRemove)
      )
      .catch((err) => console.error('[UserSync] notifyUserSyncIntegrations failed:', err))
  }

  return { segmentId, added: toAdd.length, removed: toRemove.length }
}

/**
 * Evaluate all active dynamic segments.
 */
export async function evaluateAllDynamicSegments(): Promise<EvaluationResult[]> {
  const dynamicSegments = await db
    .select({ id: segments.id })
    .from(segments)
    .where(and(eq(segments.type, 'dynamic'), isNull(segments.deletedAt)))

  const results: EvaluationResult[] = []
  for (const seg of dynamicSegments) {
    const result = await evaluateDynamicSegment(seg.id as SegmentId)
    results.push(result)
  }
  return results
}

/**
 * Get all segment members (principal IDs) for a given segment.
 */
export async function getSegmentMembers(segmentId: SegmentId): Promise<PrincipalId[]> {
  const rows = await db
    .select({ principalId: userSegments.principalId })
    .from(userSegments)
    .where(eq(userSegments.segmentId, segmentId))

  return rows.map((r) => r.principalId as PrincipalId)
}
