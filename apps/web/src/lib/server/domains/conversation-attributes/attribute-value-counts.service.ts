/**
 * Per-value detection counts (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3
 * monitoring): "how many conversations, created in the last N days, carry
 * each option value of this attribute" — the lightweight per-attribute
 * breakdown the competitor references show on their equivalent
 * training/reporting screens. Not wired to the
 * analytics materialized-view pipeline (that's a heavier, hourly-refreshed
 * mechanism for cross-entity dashboards); this is a cheap, live, single-
 * attribute aggregate, read straight off `conversations.custom_attributes`.
 *
 * Windowed by conversation `created_at` (the same rolling-window convention
 * `ai_usage_log`/guidance-stats use elsewhere in this domain), not by the
 * envelope's own `at` timestamp — deliberate: an attribute set once and
 * never revisited should still show up against the conversations it
 * describes, and windowing by conversation recency also gives the null
 * ("not set") bucket a well-defined denominator (every conversation in the
 * window, whether or not classification ever touched it).
 */
import { db, sql, conversationAttributeDefinitions, eq } from '@/lib/server/db'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'

export interface AttributeValueCount {
  /** null for the "not set" bucket (key absent OR an explicit null value). */
  optionId: string | null
  label: string
  count: number
}

const DEFAULT_SINCE_DAYS = 30
/** "Not set" label for the unset/null bucket the UI always shows last. */
const UNSET_LABEL = 'Not set'

interface CountRow {
  optionId: string | null
  count: number
}

/**
 * Per-option counts of conversations created in the last `sinceDays` days,
 * plus one trailing "not set" bucket. Throws NOT_FOUND for an unknown key
 * and VALIDATION_ERROR for a non-select attribute (option-id counting only
 * makes sense against a fixed option set — the same `select`-only
 * constraint the classifier itself enforces).
 */
export async function attributeValueCounts(input: {
  key: string
  sinceDays?: number
}): Promise<AttributeValueCount[]> {
  const def = await db.query.conversationAttributeDefinitions.findFirst({
    where: eq(conversationAttributeDefinitions.key, input.key),
  })
  if (!def) {
    throw new NotFoundError('ATTRIBUTE_NOT_FOUND', `No attribute definition for key '${input.key}'`)
  }
  if (def.fieldType !== 'select') {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Value counts are only available for select attributes'
    )
  }

  const sinceDays =
    input.sinceDays !== undefined && input.sinceDays > 0
      ? Math.floor(input.sinceDays)
      : DEFAULT_SINCE_DAYS

  const rows = (await db.execute(sql`
    SELECT (custom_attributes -> ${input.key} ->> 'v') AS "optionId", COUNT(*)::int AS count
    FROM conversations
    WHERE created_at >= now() - interval '${sql.raw(String(sinceDays))} days'
    GROUP BY "optionId"
  `)) as unknown as CountRow[]

  const options = def.options ?? []
  const knownIds = new Set(options.map((o) => o.id))
  const byOptionId = new Map(rows.map((r) => [r.optionId, r.count]))

  const result: AttributeValueCount[] = options.map((o) => ({
    optionId: o.id,
    label: o.label,
    count: byOptionId.get(o.id) ?? 0,
  }))

  // Everything that isn't a known option id (null key, cleared value, or a
  // stale option id from a value set before the option was ever renamed/
  // removed-then-recreated) folds into one "not set" bucket.
  const unsetCount = rows
    .filter((r) => r.optionId === null || !knownIds.has(r.optionId))
    .reduce((sum, r) => sum + r.count, 0)
  result.push({ optionId: null, label: UNSET_LABEL, count: unsetCount })

  return result
}
