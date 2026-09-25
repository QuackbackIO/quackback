import { queryOptions } from '@tanstack/react-query'
import { supportReportingFn, attributeBreakdownFn } from '@/lib/server/functions/support-reporting'

/** SLA attainment (overall, per policy, breach heatmap, time-after-miss) +
 *  workflow effectiveness for a date range (ISO strings). */
export const supportReportingQuery = (from: string, to: string) =>
  queryOptions({
    queryKey: ['support-reporting', from, to],
    queryFn: () => supportReportingFn({ data: { from, to } }),
    staleTime: 5 * 60 * 1000,
  })

/** Per-value conversation counts for one custom attribute over a date range
 *  (§C2.7 reporting segmentation). */
export const attributeBreakdownQuery = (key: string, from: string, to: string) =>
  queryOptions({
    queryKey: ['support-reporting', 'attribute-breakdown', key, from, to],
    queryFn: () => attributeBreakdownFn({ data: { key, from, to } }),
    staleTime: 5 * 60 * 1000,
  })
