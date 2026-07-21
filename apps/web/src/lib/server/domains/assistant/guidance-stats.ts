/** Honest per-rule application counts derived from privacy-minimal assistant usage metadata. */
import { db, sql } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { AI_USAGE_RETENTION_DAYS } from '@/lib/server/domains/ai/usage-log'

export interface GuidanceRuleStat {
  applied: number
  lastAppliedAt: Date
}

interface GuidanceStatRow {
  ruleId: string
  applied: number | string
  lastAppliedAt: Date | string
}

/** Missing rules are absent from the map and are presented by callers as zero applications. */
export async function getGuidanceRuleStats(
  exec: Executor = db
): Promise<Record<string, GuidanceRuleStat>> {
  const rows = (await exec.execute(sql`
    WITH applications AS (
      SELECT DISTINCT ai_usage_log.id, rule_id, ai_usage_log.created_at
      FROM ai_usage_log
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(metadata->'guidanceAppliedIds') = 'array'
             THEN metadata->'guidanceAppliedIds'
             ELSE '[]'::jsonb
        END
      ) AS rule_id
      WHERE pipeline_step = 'assistant'
        AND call_type = 'chat_completion'
        AND status = 'success'
        AND created_at >= now() - interval '${sql.raw(String(AI_USAGE_RETENTION_DAYS))} days'
    )
    SELECT rule_id AS "ruleId",
           count(*)::integer AS "applied",
           max(created_at) AS "lastAppliedAt"
    FROM applications
    GROUP BY rule_id
  `)) as unknown as GuidanceStatRow[]

  const stats: Record<string, GuidanceRuleStat> = {}
  for (const row of rows) {
    stats[row.ruleId] = {
      applied: Number(row.applied),
      lastAppliedAt:
        row.lastAppliedAt instanceof Date ? row.lastAppliedAt : new Date(row.lastAppliedAt),
    }
  }
  return stats
}
