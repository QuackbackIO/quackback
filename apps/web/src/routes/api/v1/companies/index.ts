import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import type { CompanyId } from '@quackback/ids'
import { serializeCompany } from './-serialize'

export const Route = createFileRoute('/api/v1/companies/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/companies
       * List companies with their member counts, cursor-paginated
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.COMPANY_VIEW })

          const url = new URL(request.url)
          const search = url.searchParams.get('search') ?? undefined
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )

          const { isValidTypeId } = await import('@quackback/ids')
          const cursorId =
            cursor && isValidTypeId(cursor, 'company') ? (cursor as CompanyId) : undefined

          const { listCompaniesPage } =
            await import('@/lib/server/domains/companies/company.service')
          const page = await listCompaniesPage({ search, limit, cursor: cursorId })

          return successResponse(page.items.map(serializeCompany), {
            pagination: {
              cursor: page.nextCursor,
              hasMore: page.hasMore,
            },
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
