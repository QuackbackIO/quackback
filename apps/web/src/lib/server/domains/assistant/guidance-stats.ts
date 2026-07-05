/**
 * Guidance-rule effectiveness stats — the Used count + Resolved % the
 * guidance rules card shows on each rule (mirrors Fin's Guidance table).
 * Aggregates over `ai_usage_log`: assistant.runtime's buildGuidancePrompt
 * records the rule ids it actually folded into a turn's prompt as
 * `metadata.guidanceRuleIds`, so every successful assistant turn listing a
 * rule id is one "use" of that rule; a use counts as resolved when the turn's
 * conversation ultimately landed in the assistant-involvement resolved bucket.
 *
 * Two-step rather than one query: `metadata->>'conversationId'` is the
 * app-level TypeID string (JSON has no uuid type), while
 * `assistant_involvements.conversation_id` is stored as a native uuid —
 * joining the two needs the TypeID<->uuid codec Drizzle applies on read,
 * which a single raw-SQL query can't reach into. Step 1 unnests the jsonb
 * array per turn in SQL; step 2 resolves the referenced conversations'
 * involvement outcomes through the query builder (so the codec runs) and the
 * two are folded together in memory.
 *
 * Step 1 bounds itself to the last `AI_USAGE_RETENTION_DAYS` — the same
 * rolling window `ai_usage_log` retention already enforces, so the visible
 * stats are unchanged, but the added `created_at` lower bound (plus the
 * `call_type` filter every assistant turn is logged with) lets the query
 * ride the partial index from migration 0051 instead of scanning every AI
 * call ever logged app-wide.
 */
import { db, assistantInvolvements, inArray, desc, sql } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantInvolvementStatus } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { AI_INBOX_BUCKETS } from './assistant.involvement'
import { AI_USAGE_RETENTION_DAYS } from '@/lib/server/domains/ai/usage-log'
import { ratePctOrNull } from '@/lib/shared/percent'

export interface GuidanceRuleStat {
  /** Successful assistant turns this rule was folded into the prompt for. */
  used: number
  /** Of those, how many turns' conversation landed in the resolved bucket. */
  resolved: number
  /** resolved / used, 0-100; null (never NaN) when used is 0. */
  resolvedPct: number | null
}

/** resolved / used as a 0-100 percent; null (not NaN) when nothing used the rule. */
export function computeResolvedPct(used: number, resolved: number): number | null {
  return ratePctOrNull(resolved, used)
}

const RESOLVED_STATUSES = new Set<AssistantInvolvementStatus>(AI_INBOX_BUCKETS.resolved)

interface GuidanceTurnRow {
  ruleId: string
  conversationId: string | null
}

/**
 * Per-rule Used/Resolved stats over every successful assistant turn that
 * recorded guidance rule ids in the last `AI_USAGE_RETENTION_DAYS`. A rule
 * with zero turns is simply absent from the returned record — callers treat
 * a missing entry the same as `{ used: 0, resolved: 0, resolvedPct: null }`.
 */
export async function getGuidanceRuleStats(
  exec: Executor = db
): Promise<Record<string, GuidanceRuleStat>> {
  // One row per (rule, turn): unnest the jsonb array, guarded so a row whose
  // guidanceRuleIds is missing or malformed contributes zero rows rather than
  // erroring the whole query (jsonb_array_elements_text throws on a non-array).
  const turns = (await exec.execute(sql`
    SELECT rule_id AS "ruleId", metadata->>'conversationId' AS "conversationId"
    FROM ai_usage_log
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(metadata->'guidanceRuleIds') = 'array'
           THEN metadata->'guidanceRuleIds'
           ELSE '[]'::jsonb
      END
    ) AS rule_id
    WHERE pipeline_step = 'assistant'
      AND call_type = 'chat_completion'
      AND status = 'success'
      AND created_at >= now() - interval '${sql.raw(String(AI_USAGE_RETENTION_DAYS))} days'
  `)) as unknown as GuidanceTurnRow[]

  if (turns.length === 0) return {}

  const conversationIds = [
    ...new Set(turns.map((t) => t.conversationId).filter((id): id is string => id !== null)),
  ]
  const resolvedConversationIds = await resolvedConversationIdSet(conversationIds, exec)

  const stats: Record<string, GuidanceRuleStat> = {}
  for (const turn of turns) {
    const stat = (stats[turn.ruleId] ??= { used: 0, resolved: 0, resolvedPct: null })
    stat.used++
    if (turn.conversationId && resolvedConversationIds.has(turn.conversationId)) stat.resolved++
  }
  for (const stat of Object.values(stats)) {
    stat.resolvedPct = computeResolvedPct(stat.used, stat.resolved)
  }
  return stats
}

/**
 * The subset of the given conversations whose LATEST assistant involvement
 * landed in the resolved bucket. A conversation can carry more than one
 * involvement over time (e.g. handed off, then re-engaged later), so this
 * takes the most recent row per conversation rather than any match.
 */
async function resolvedConversationIdSet(
  conversationIds: string[],
  exec: Executor
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set()
  const rows = await exec
    .select({
      conversationId: assistantInvolvements.conversationId,
      status: assistantInvolvements.status,
    })
    .from(assistantInvolvements)
    .where(inArray(assistantInvolvements.conversationId, conversationIds as ConversationId[]))
    .orderBy(desc(assistantInvolvements.createdAt))

  const seen = new Set<string>()
  const resolved = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.conversationId)) continue
    seen.add(row.conversationId)
    if (RESOLVED_STATUSES.has(row.status)) resolved.add(row.conversationId)
  }
  return resolved
}
