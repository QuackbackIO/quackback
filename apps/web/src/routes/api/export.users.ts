import { createFileRoute } from '@tanstack/react-router'
import { escapeCSV } from '@/lib/server/utils/csv'
import { logger } from '@/lib/server/logger'
import type { SegmentId } from '@quackback/ids'

const log = logger.child({ component: 'export-users' })

const MAX_EXPORT_USERS = 10000

/**
 * Parse the directory's URL filters (§I3): the same ones the /admin/users
 * page applies, so the export matches exactly what the filtered list shows.
 * Activity-count and custom-attribute filters aren't included — a bulk
 * export is a CRM/email-marketing use case where identity/segment/lifecycle
 * matter far more than "voted at least 3 times."
 */
function parseFilter(url: URL) {
  const search = url.searchParams.get('search') ?? undefined
  const verifiedRaw = url.searchParams.get('verified')
  const verified = verifiedRaw === 'true' ? true : verifiedRaw === 'false' ? false : undefined
  const dateFromRaw = url.searchParams.get('dateFrom')
  const dateToRaw = url.searchParams.get('dateTo')
  const emailDomain = url.searchParams.get('emailDomain') ?? undefined
  const lifecycleRaw = url.searchParams.get('lifecycle')
  const lifecycle = lifecycleRaw === 'leads' ? 'leads' : 'users'
  const segmentIdsRaw = url.searchParams.get('segmentIds')

  return {
    search,
    verified,
    dateFrom: dateFromRaw ? new Date(dateFromRaw) : undefined,
    dateTo: dateToRaw ? new Date(dateToRaw) : undefined,
    emailDomain,
    lifecycle: lifecycle as 'users' | 'leads',
    segmentIds: segmentIdsRaw
      ? (segmentIdsRaw.split(',').filter(Boolean) as SegmentId[])
      : undefined,
  }
}

/**
 * GET /api/export/users
 * Export the filtered users/leads directory to CSV.
 */
export async function handleExportUsers(request: Request): Promise<Response> {
  const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
  const { PERMISSIONS } = await import('@/lib/shared/permissions')
  const { listPortalUsers } = await import('@/lib/server/domains/users/user.service')
  const { realEmail } = await import('@/lib/shared/anonymous-email')

  log.info('users csv export started')
  try {
    let settingsSlug: string
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.PEOPLE_VIEW })
      settingsSlug = auth.settings.slug
    } catch {
      return Response.json({ error: 'Access denied' }, { status: 403 })
    }

    // Tier gate: data exports are a Pro+ feature (same gate as posts/companies).
    const { getTierLimits } = await import('@/lib/server/domains/settings/tier-limits.service')
    const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
    const limits = await getTierLimits()
    enforceFeatureGate({
      enabled: limits.features.analyticsExports,
      feature: 'analyticsExports',
      friendly: 'Data export',
    })

    const filter = parseFilter(new URL(request.url))
    const { items } = await listPortalUsers({
      ...filter,
      limit: MAX_EXPORT_USERS,
      page: 1,
    })

    const headers = [
      'name',
      'email',
      'verified',
      'lifecycle',
      'segments',
      'joined_at',
      'last_seen_at',
      'post_count',
      'comment_count',
      'vote_count',
    ]

    const rows = items.map((user) => [
      escapeCSV(user.name ?? ''),
      escapeCSV(realEmail(user.email) ?? realEmail(user.contactEmail) ?? ''),
      String(user.emailVerified),
      user.isLead ? 'lead' : 'user',
      escapeCSV(user.segments.map((s) => s.name).join(',')),
      user.joinedAt.toISOString(),
      user.lastSeenAt ? user.lastSeenAt.toISOString() : '',
      String(user.postCount),
      String(user.commentCount),
      String(user.voteCount),
    ])

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
    const filename = `users-export-${settingsSlug}-${Date.now()}.csv`

    log.info({ user_count: items.length }, 'users csv export complete')
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
    if (error instanceof TierLimitError) {
      return Response.json(error.toResponseBody(), { status: error.statusCode })
    }
    log.error({ err: error }, 'users csv export failed')
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/export/users')({
  server: {
    handlers: {
      GET: ({ request }) => handleExportUsers(request),
    },
  },
})
