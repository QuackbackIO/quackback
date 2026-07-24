/**
 * Server functions for the companies directory (support platform §4.4).
 *
 * Reads are gated on company.view, mutations on company.manage. Both keys
 * already exist in the RBAC catalogue. Follow-up: granularize company.manage
 * (e.g. a separate link/unlink verb) if the surface grows.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PrincipalId, CompanyAttributeId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { toIsoString } from '@/lib/shared/utils'
import type { JsonValue } from '@/lib/shared/json'
import { requireAuth } from './auth-helpers'
import {
  createCompany,
  updateCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  listCompaniesPage,
  countCompanies,
  listMembers,
  getActivityCounts,
  getForPrincipal,
  attachPrincipal,
  detachPrincipal,
  qualifyCompany,
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
  size: string | null
  website: string | null
  industry: string | null
  source: 'api' | 'manual'
  customAttributes: Record<string, JsonValue>
  createdAt: string
  updatedAt: string
}

export interface CompanyWithMemberCountDTO extends CompanyDTO {
  memberCount: number
}

function serializeCompany(company: Company): CompanyDTO {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    externalId: company.externalId,
    plan: company.plan,
    mrrCents: company.mrrCents,
    size: company.size,
    website: company.website,
    industry: company.industry,
    source: company.source,
    // jsonb round-trips as JSON; the cast narrows drizzle's `unknown` values.
    customAttributes: company.customAttributes as Record<string, JsonValue>,
    createdAt: toIsoString(company.createdAt),
    updatedAt: toIsoString(company.updatedAt),
  }
}

function serializeCompanyWithCount(company: CompanyWithMemberCount): CompanyWithMemberCountDTO {
  return { ...serializeCompany(company), memberCount: company.memberCount }
}

/** One keyset page of companies for the directory list. */
export interface CompanyListPageDTO {
  items: CompanyWithMemberCountDTO[]
  hasMore: boolean
  nextCursor: string | null
}

const companyInputSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  plan: z.string().max(100).nullable().optional(),
  mrrCents: z.number().int().nullable().optional(),
  size: z.string().max(100).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

const updateCompanySchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(255).nullable().optional(),
  externalId: z.string().max(255).nullable().optional(),
  plan: z.string().max(100).nullable().optional(),
  mrrCents: z.number().int().nullable().optional(),
  size: z.string().max(100).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  industry: z.string().max(100).nullable().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

/** Directory filters — mirrors the People tab's URL-encodable shapes. */
const listCompaniesSchema = z
  .object({
    search: z.string().max(200).optional(),
    plan: z.string().max(100).optional(),
    mrr: z.object({ op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']), value: z.number() }).optional(),
    fields: z
      .array(
        z.object({ key: z.string().max(64), op: z.string().max(16), value: z.string().max(200) })
      )
      .max(10)
      .optional(),
    attrs: z
      .array(
        z.object({ key: z.string().max(64), op: z.string().max(16), value: z.string().max(200) })
      )
      .max(10)
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .optional()

/** Full unpaginated list — used where every row is needed (inbox company
 *  picker, CSV export). The interactive directory uses listCompaniesPageFn. */
export const listCompaniesFn = createServerFn({ method: 'GET' })
  .validator(listCompaniesSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    const companies = await listCompanies(data ?? {})
    return companies.map(serializeCompanyWithCount)
  })

/** One keyset page of companies for the interactive directory list. */
export const listCompaniesPageFn = createServerFn({ method: 'GET' })
  .validator(listCompaniesSchema)
  .handler(async ({ data }): Promise<CompanyListPageDTO> => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    const page = await listCompaniesPage(data ?? {})
    return {
      items: page.items.map(serializeCompanyWithCount),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    }
  })

/** Cheap total-company count for the directory nav badge. Honors the same
 *  filters as listCompaniesFn (the badge shows the unfiltered total). */
export const countCompaniesFn = createServerFn({ method: 'GET' })
  .validator(listCompaniesSchema)
  .handler(async ({ data }): Promise<number> => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    return countCompanies(data ?? {})
  })

/** The people attached to a company (directory profile roster). */
export const listCompanyMembersFn = createServerFn({ method: 'GET' })
  .validator(z.object({ companyId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    const members = await listMembers(data.companyId as CompanyId)
    return members.map((m) => ({ ...m, createdAt: toIsoString(m.createdAt) }))
  })

/** Activity rollup counts for the company profile. */
export const getCompanyActivityFn = createServerFn({ method: 'GET' })
  .validator(z.object({ companyId: z.string() }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
    return getActivityCounts(data.companyId as CompanyId)
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

/**
 * Inbox-sidebar qualification: committing a name creates-or-attaches by
 * case-insensitive name match (source 'manual' on create).
 */
export const qualifyCompanyFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      principalId: z.string(),
      name: z.string().min(1).max(200),
      size: z.string().max(100).nullable().optional(),
      website: z.string().max(255).nullable().optional(),
      industry: z.string().max(100).nullable().optional(),
    })
  )
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    log.info({ principal_id: data.principalId }, 'qualify company')
    return serializeCompany(await qualifyCompany(data))
  })

// ============================================
// Company Attribute Definitions (§K2)
// ============================================

const attributeTypeSchema = z.enum(['string', 'number', 'boolean', 'date', 'currency'])
const currencyCodeSchema = z.enum([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL',
])

const createCompanyAttributeSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  type: attributeTypeSchema,
  currencyCode: currencyCodeSchema.optional(),
  externalKey: z.string().max(256).optional().nullable(),
})

const updateCompanyAttributeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional().nullable(),
  type: attributeTypeSchema.optional(),
  currencyCode: currencyCodeSchema.optional().nullable(),
  externalKey: z.string().max(256).optional().nullable(),
})

/** List all company attribute definitions. */
export const listCompanyAttributesFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.COMPANY_VIEW })
  const { listCompanyAttributes } = await import('@/lib/server/domains/company-attributes')
  return listCompanyAttributes()
})

/** Create a new company attribute definition. */
export const createCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(createCompanyAttributeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    const { createCompanyAttribute } = await import('@/lib/server/domains/company-attributes')
    return createCompanyAttribute(data)
  })

/** Update an existing company attribute definition. */
export const updateCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(updateCompanyAttributeSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    const { updateCompanyAttribute } = await import('@/lib/server/domains/company-attributes')
    const { id, ...input } = data
    return updateCompanyAttribute(id as CompanyAttributeId, input)
  })

/** Delete a company attribute definition. */
export const deleteCompanyAttributeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.COMPANY_MANAGE })
    const { deleteCompanyAttribute } = await import('@/lib/server/domains/company-attributes')
    await deleteCompanyAttribute(data.id as CompanyAttributeId)
    return { deleted: true }
  })
