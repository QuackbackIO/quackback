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

          // Integration lookup filters: company_id is an exact match on the
          // external reference; tag_id/segment_id restrict the list.
          const externalId = url.searchParams.get('company_id') ?? undefined
          const tagIdParam = url.searchParams.get('tag_id') ?? undefined
          const segmentIdParam = url.searchParams.get('segment_id') ?? undefined

          const { isValidTypeId } = await import('@quackback/ids')
          const cursorId =
            cursor && isValidTypeId(cursor, 'company') ? (cursor as CompanyId) : undefined
          const tagId = tagIdParam && isValidTypeId(tagIdParam, 'post_tag') ? tagIdParam : undefined
          const segmentId =
            segmentIdParam && isValidTypeId(segmentIdParam, 'segment') ? segmentIdParam : undefined

          // A restriction filter that cannot resolve must never widen the
          // result set: a present-but-malformed tag/segment id degrades to an
          // empty page, not an error and not an unfiltered list.
          if ((tagIdParam && !tagId) || (segmentIdParam && !segmentId)) {
            return successResponse([], { pagination: { cursor: null, hasMore: false } })
          }

          const { listCompaniesPage } =
            await import('@/lib/server/domains/companies/company.service')
          const page = await listCompaniesPage({
            search,
            limit,
            cursor: cursorId,
            externalId,
            tagId,
            segmentId,
          })

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
