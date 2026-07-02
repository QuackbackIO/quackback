/**
 * Server functions for the companies directory (support platform §4.4).
 *
 * Reads are gated on company.view, mutations on company.manage. Both keys
 * already exist in the RBAC catalogue. Follow-up: granularize company.manage
 * (e.g. a separate link/unlink verb) if the surface grows.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { toIsoString } from '@/lib/shared/utils'
import { requireAuth } from './auth-helpers'
import {
  createCompany,
  updateCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  getForPrincipal,
  attachPrincipal,
  detachPrincipal,
  type Company,
  type CompanyId,
  type CompanyWithMemberCount,
} from '@/lib/server/domains/companies'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'companies' })

/**
 * Client-facing company shape (dates as ISO strings). Declared explicitly so
 * the createServerFn boundary keeps a concrete type instead of collapsing the
 * inferred mapped type.
 */
export interface CompanyDTO {
  id: string
  name: string
  domain: string | null
  externalId: string | null
  plan: string | null
  mrrCents: number | null
  createdAt: string
  updatedAt: string
}

export interface CompanyWithMemberCountDTO extends CompanyDTO {
  memberCount: number
}

// customAttributes (jsonb) is intentionally not surfaced over the client
// boundary yet; no UI consumes it and it keeps the serialized type clean.
function serializeCompany(company: Company): CompanyDTO {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    externalId: company.externalId,
    plan: company.plan,
    mrrCents: company.mrrCents,
    createdAt: toIsoString(company.createdAt),
    updatedAt: toIsoString(company.updatedAt),
  }
}

function serializeCompanyWithCount(company: CompanyWithMemberCount): CompanyWithMemberCountDTO {
  return { ...serializeCompany(company), memberCount: company.memberCount }
}

const companyInputSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  plan: z.string().max(100).nullable().optional(),
  mrrCents: z.number().int().nullable().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

const updateCompanySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  plan: z.string().max(100).nullable().optional(),
  mrrCents: z.number().int().nullable().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

export const listCompaniesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
  const companies = await listCompanies()
  return companies.map(serializeCompanyWithCount)
})

export const getCompanyFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    return serializeCompany(await getCompany(data.id as CompanyId))
  })

/** The company a person belongs to (for the conversation detail sidebar). */
export const getCompanyForPrincipalFn = createServerFn({ method: 'GET' })
  .validator(z.object({ principalId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    const company = await getForPrincipal(data.principalId as PrincipalId)
    return company ? serializeCompany(company) : null
  })

export const createCompanyFn = createServerFn({ method: 'POST' })
  .validator(companyInputSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    log.info({ name: data.name }, 'create company')
    return serializeCompany(await createCompany(data))
  })

export const updateCompanyFn = createServerFn({ method: 'POST' })
  .validator(updateCompanySchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    const { id, ...input } = data
    log.info({ company_id: id }, 'update company')
    return serializeCompany(await updateCompany(id as CompanyId, input))
  })

export const deleteCompanyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    log.info({ company_id: data.id }, 'delete company')
    await deleteCompany(data.id as CompanyId)
    return { id: data.id }
  })

export const attachPrincipalToCompanyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ companyId: z.string(), principalId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    await attachPrincipal(data.companyId as CompanyId, data.principalId as PrincipalId)
    return { ok: true }
  })

export const detachPrincipalFromCompanyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ principalId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    await detachPrincipal(data.principalId as PrincipalId)
    return { ok: true }
  })
