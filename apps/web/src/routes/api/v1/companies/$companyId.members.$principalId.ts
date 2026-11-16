import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { noContentResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { CompanyId, PrincipalId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/companies/$companyId/members/$principalId')({
  server: {
    handlers: {
      /**
       * PUT /api/v1/companies/:companyId/members/:principalId
       * Link a person to a company. Repeating it is a no-op; a person belongs to
       * one company, so this moves them if they were linked elsewhere.
       */
      PUT: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.COMPANY_MANAGE })

          const companyId = parseTypeId<CompanyId>(params.companyId, 'company', 'company ID')
          const principalId = parseTypeId<PrincipalId>(
            params.principalId,
            'principal',
            'principal ID'
          )

          const { attachPrincipal } = await import('@/lib/server/domains/companies/company.service')
          await attachPrincipal(companyId, principalId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
