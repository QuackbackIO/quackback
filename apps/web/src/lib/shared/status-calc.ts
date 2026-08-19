/**
 * Pure status-page derivations shared by server and client (the report
 * dialog previews derived impact live while services are picked; the
 * Overview banner derives the public top-level status). No DB access.
 *
 * The literal unions here mirror the pgEnums in packages/db/src/schema —
 * `domains/status/status.calc.ts` pins them against the schema types at
 * compile time, so a schema enum change fails typecheck here rather than
 * silently drifting.
 */

export type StatusCalcComponentStatus =
  | 'operational'
  | 'under_maintenance'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'

export type StatusCalcImpact = 'none' | 'minor' | 'major' | 'critical' | 'maintenance'

/**
 * Severity order for the worst-of derivations. `operational` is the baseline
 * (contributes nothing); among the rest, maintenance ranks below the three
 * outage severities (Status Product Spec §2).
 */
export const SEVERITY_ORDER: readonly StatusCalcComponentStatus[] = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
]

/**
 * Top-level page status: all components operational -> 'operational'; else
 * the worst status present, ranked maintenance < degraded < partial < major.
 * Empty input (no visible components) is treated as operational.
 */
export function deriveTopLevelStatus(
  componentStatuses: StatusCalcComponentStatus[]
): StatusCalcComponentStatus {
  let worstRank = 0
  for (const status of componentStatuses) {
    const rank = SEVERITY_ORDER.indexOf(status)
    if (rank > worstRank) worstRank = rank
  }
  return SEVERITY_ORDER[worstRank]
}

const IMPACT_RANK: Record<StatusCalcComponentStatus, number> = {
  operational: 0,
  // Maintenance is not an incident-impact signal; it never raises impact.
  under_maintenance: 0,
  degraded_performance: 1,
  partial_outage: 2,
  major_outage: 3,
}

const IMPACT_BY_RANK: readonly StatusCalcImpact[] = ['none', 'minor', 'major', 'critical']

/**
 * Auto-derived incident impact from the worst affected-component status.
 * Only meaningful for kind='incident' — maintenance rows always use the
 * literal 'maintenance' impact value instead of calling this.
 */
export function deriveImpact(componentStatuses: StatusCalcComponentStatus[]): StatusCalcImpact {
  let worstRank = 0
  for (const status of componentStatuses) {
    const rank = IMPACT_RANK[status]
    if (rank > worstRank) worstRank = rank
  }
  return IMPACT_BY_RANK[worstRank]
}
