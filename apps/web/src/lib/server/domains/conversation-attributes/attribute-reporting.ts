/**
 * Conversation-attribute value breakdown (C2.7 / AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 4): per-value conversation counts for one attribute over a date
 * range — the segmentation dimension both competitors' "reporting-ready
 * structure" pitch is built on, for human-set AND AI-set values alike.
 *
 * Deliberately the lightweight direct-query shape `sla-reporting.ts` /
 * `workflow-reporting.ts` use, not the materialized-view analytics pipeline
 * (`analytics.service.ts`'s hourly BullMQ rollup) — that pipeline's summary
 * shape is baked into a fixed set of matviews recomputed on a schedule, so
 * wiring an arbitrary admin-chosen attribute key into it is a much larger
 * change than this feature warrants for v1. A future iteration can promote
 * this into the dashboard's matview if per-key breakdowns need to sit
 * alongside the other Analytics sections; see the Phase 4 report for what's
 * deferred.
 *
 * Aggregation happens in application code rather than a SQL GROUP BY: a
 * multi_select value can contribute a conversation to several buckets at
 * once (one row can't GROUP BY into many buckets without an UNNEST/LATERAL
 * join), and folding the envelope-unwrap + array-unnest + legacy-bare-value
 * fallback into one portable SQL expression is far more fragile than doing
 * it in TypeScript once per row. Conversation volume in a date-range window
 * is the same order of magnitude other admin reads already pull (e.g. the
 * inbox list), so this stays cheap in practice; revisit with a GROUP BY if a
 * workspace's window ever gets large enough for it to matter.
 */
import { db, and, gte, lt, sql, conversations } from '@/lib/server/db'

export interface AttributeValueBreakdownCount {
  /** The stored value's string form — an option id for select/multi_select,
   *  the stringified value for text/number/checkbox/date. */
  value: string
  count: number
}

export interface AttributeBreakdown {
  /** Conversations created in the window with no value at all for this key
   *  (key absent, or an explicit null/''/[] — mirrors `attributeHasValue`). */
  unset: number
  /** Per-value counts, most-frequent first (ties broken alphabetically). A
   *  multi_select conversation contributes to every one of its selected
   *  values — this is "how many conversations touched this value", not a
   *  partition, so the counts across `values` need not sum to the window's
   *  total conversation count. */
  values: AttributeValueBreakdownCount[]
}

/** The envelope-unwrapped jsonb value at `custom_attributes -> key` — mirrors
 *  `attributeValueExpr` in conversation.query.ts (kept separate: that module
 *  builds WHERE predicates, this one just needs the raw jsonb text form to
 *  aggregate in JS). */
function effectiveValueTextExpr(key: string) {
  return sql<string | null>`(CASE
    WHEN jsonb_typeof(${conversations.customAttributes} -> ${key}) = 'object'
         AND (${conversations.customAttributes} -> ${key}) ? 'v'
    THEN ${conversations.customAttributes} -> ${key} -> 'v'
    ELSE ${conversations.customAttributes} -> ${key}
  END)::text`
}

/**
 * Per-value counts for one attribute key, over conversations created in
 * [from, to). Unset/empty values (missing key, null, '', []) fold into
 * `unset` rather than appearing as a value bucket.
 */
export async function attributeValueBreakdown(
  key: string,
  from: Date,
  to: Date
): Promise<AttributeBreakdown> {
  const rows = await db
    .select({ value: effectiveValueTextExpr(key) })
    .from(conversations)
    .where(and(gte(conversations.createdAt, from), lt(conversations.createdAt, to)))

  let unset = 0
  const counts = new Map<string, number>()
  const bump = (v: string) => counts.set(v, (counts.get(v) ?? 0) + 1)

  for (const row of rows) {
    // `::text` on jsonb yields its JSON text form (quoted strings, bracketed
    // arrays), so a round-trip through JSON.parse recovers the real shape —
    // SQL NULL (key absent) comes back as JS null, never the string 'null'.
    if (row.value === null) {
      unset++
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(row.value)
    } catch {
      // Malformed jsonb text should never happen; treat defensively as unset
      // rather than throwing a reporting read.
      unset++
      continue
    }
    if (parsed === null || parsed === '') {
      unset++
      continue
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        unset++
        continue
      }
      for (const member of parsed) bump(String(member))
      continue
    }
    bump(String(parsed))
  }

  const values = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  return { unset, values }
}
