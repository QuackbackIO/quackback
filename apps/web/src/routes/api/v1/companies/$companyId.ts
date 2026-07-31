import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { CompanyId } from '@quackback/ids'
import { serializeCompany } from './-serialize'

export const Route = createFileRoute('/api/v1/companies/$companyId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/companies/:companyId
       * Get a single company with its member count
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.COMPANY_VIEW })

          const companyId = parseTypeId<CompanyId>(params.companyId, 'company', 'company ID')

          const { getCompanyWithMemberCount } =
            await import('@/lib/server/domains/companies/company.service')
          const company = await getCompanyWithMemberCount(companyId)

          return successResponse(serializeCompany(company))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
