/**
 * Ratio-to-percent conversion shared by the reporting domains (Quinn
 * performance, Quinn tools, guidance-rule stats): a rounded 0-100
 * whole-number percent, or null (never NaN) when there's nothing to divide
 * by. Callers that want a default other than null (e.g. a KPI tile that
 * always renders a number) coalesce the result at the call site.
 */
export function ratePctOrNull(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null
}
