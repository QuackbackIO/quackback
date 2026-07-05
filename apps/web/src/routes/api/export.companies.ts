import { createFileRoute } from '@tanstack/react-router'
import { escapeCSV } from '@/lib/server/utils/csv'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'export-companies' })

/**
 * Parse the directory's URL-encoded filters (same formats the /admin/users
 * Companies tab writes): `mrr` as "op:value", `attrs` as "key:op:value" parts
 * joined by commas. Standard-column keys inside `attrs` (plan) are routed to
 * their columns so the export matches exactly what the filtered list shows.
 */
function parseFilter(url: URL) {
  const search = url.searchParams.get('search') ?? undefined
  const plan = url.searchParams.get('plan') ?? undefined

  let mrr: { op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number } | undefined
  const mrrRaw = url.searchParams.get('mrr')
  if (mrrRaw) {
    const [op, val] = mrrRaw.split(':')
    if (op && val !== undefined && ['gt', 'gte', 'lt', 'lte', 'eq'].includes(op)) {
      const value = Number(val)
      if (!Number.isNaN(value)) mrr = { op: op as 'gt' | 'gte' | 'lt' | 'lte' | 'eq', value }
    }
  }

  const parseTriples = (raw: string | null) => {
    const out: { key: string; op: string; value: string }[] = []
    for (const part of (raw ?? '').split(',').filter(Boolean)) {
      const [key, op, ...rest] = part.split(':')
      if (key && op) out.push({ key, op, value: rest.join(':') })
    }
    return out.length > 0 ? out : undefined
  }

  return {
    search,
    plan,
    mrr,
    fields: parseTriples(url.searchParams.get('fields')),
    attrs: parseTriples(url.searchParams.get('attrs')),
  }
}

export const Route = createFileRoute('/api/export/companies')({
  server: {
    handlers: {
      /**
       * GET /api/export/companies
       * Export the filtered companies directory to CSV.
       */
      GET: async ({ request }) => {
        const { requireAuth } = await import('@/lib/server/functions/auth-helpers')
        const { PERMISSIONS } = await import('@/lib/shared/permissions')
        const { listCompanies } = await import('@/lib/server/domains/companies')

        log.info('companies csv export started')
        try {
          let settingsSlug: string
          try {
            const auth = await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
            settingsSlug = auth.settings.slug
          } catch {
            return Response.json({ error: 'Access denied' }, { status: 403 })
          }

          // Tier gate: data exports are a Pro+ feature (same gate as the posts export).
          const { getTierLimits } =
            await import('@/lib/server/domains/settings/tier-limits.service')
          const { enforceFeatureGate } = await import('@/lib/server/domains/settings/tier-enforce')
          const limits = await getTierLimits()
          enforceFeatureGate({
            enabled: limits.features.analyticsExports,
            feature: 'analyticsExports',
            friendly: 'Data export',
          })

          const filter = parseFilter(new URL(request.url))
          const companies = await listCompanies(filter)

          const headers = [
            'name',
            'domain',
            'external_id',
            'plan',
            'monthly_spend',
            'people_count',
            'created_at',
          ]

          const rows = companies.map((c) => [
            escapeCSV(c.name),
            escapeCSV(c.domain ?? ''),
            escapeCSV(c.externalId ?? ''),
            escapeCSV(c.plan ?? ''),
            c.mrrCents != null ? (c.mrrCents / 100).toFixed(2) : '',
            String(c.memberCount),
            c.createdAt.toISOString(),
          ])

          const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
          const filename = `companies-export-${settingsSlug}-${Date.now()}.csv`

          log.info({ company_count: companies.length }, 'companies csv export complete')
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
          log.error({ err: error }, 'companies csv export failed')
          return Response.json({ error: 'Internal server error' }, { status: 500 })
        }
      },
    },
  },
})
