import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { CompanyId } from '@quackback/ids'
import { serializeCompany } from './-serialize'
import { updateCompanySchema } from './-write-schemas'

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

      /**
       * PATCH /api/v1/companies/:companyId
       * Update the provided fields of a company.
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.COMPANY_MANAGE })

          const companyId = parseTypeId<CompanyId>(params.companyId, 'company', 'company ID')
          const parsed = updateCompanySchema.safeParse(await request.json().catch(() => null))
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateCompany, getCompanyWithMemberCount } =
            await import('@/lib/server/domains/companies/company.service')
          await updateCompany(companyId, parsed.data)

          return successResponse(serializeCompany(await getCompanyWithMemberCount(companyId)))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
