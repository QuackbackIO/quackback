/** Workspace-scoped monthly REST API request counter. */
export const API_MONTH_BUCKET_KEY = 'api:month'

export function secondsUntilNextUtcMonth(at = new Date()): number {
  const next = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
  return Math.max(1, Math.ceil((next.getTime() - at.getTime()) / 1000))
}

export async function apiRequestsThisMonth(): Promise<number> {
  const { getBucketCount } = await import('@/lib/server/utils/rate-bucket')
  return getBucketCount(API_MONTH_BUCKET_KEY)
}
