/**
 * Companies service (support platform §4.4): CRUD plus the person-to-company
 * links that give agents plan / MRR context in the inbox.
 *
 * `domain` is unique case-insensitively (enforced by the LOWER functional index
 * in migration 0140); `external_id` is unique when present. The DB indexes are
 * the source of truth, so a duplicate surfaces as a ConflictError from the
 * unique-violation handler rather than a racy pre-check.
 */
import {
  db,
  eq,
  and,
  asc,
  isNull,
  sql,
  companies,
  principal,
  user,
  conversations,
  tickets,
} from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { isUniqueViolation } from '@/lib/server/utils'
import { realEmail } from '@/lib/shared/anonymous-email'
import { logger } from '@/lib/server/logger'
import type {
  Company,
  CompanyId,
  CompanyWithMemberCount,
  CompanyListFilter,
  CompanyAttrFilter,
  CompanyMember,
  CompanyActivityCounts,
  CreateCompanyInput,
  UpdateCompanyInput,
  QualifyCompanyInput,
} from './company.types'

const log = logger.child({ component: 'companies' })

/** Trim to a value or null (empty strings become null so partial indexes skip them). */
function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Map a Postgres unique violation on companies onto a typed ConflictError. */
function translateUniqueError(err: unknown): never {
  if (isUniqueViolation(err)) {
    // Drizzle wraps the driver error; the pg fields live on `cause`.
    const pgErr = (err as { cause?: unknown }).cause ?? err
    const e = pgErr as { constraint?: string; constraint_name?: string; detail?: string }
    // The driver may expose the violated index as `constraint`, `constraint_name`,
    // or only in the `detail` text ("Key (external_id)=... already exists").
    const marker = `${e.constraint ?? ''} ${e.constraint_name ?? ''} ${e.detail ?? ''}`
    if (marker.includes('external_id')) {
      throw new ConflictError('COMPANY_EXTERNAL_ID_EXISTS', 'That external ID is already in use')
    }
    throw new ConflictError('COMPANY_DOMAIN_EXISTS', 'A company with that domain already exists')
  }
  throw err
}

export async function createCompany(input: CreateCompanyInput): Promise<Company> {
  const name = input.name?.trim()
  if (!name) {
    throw new ValidationError('VALIDATION_ERROR', 'Company name is required')
  }
  log.info({ name }, 'create company')
  try {
    const [row] = await db
      .insert(companies)
      .values({
        name,
        domain: nullableTrim(input.domain),
        externalId: nullableTrim(input.externalId),
        plan: nullableTrim(input.plan),
        mrrCents: input.mrrCents ?? null,
        size: nullableTrim(input.size),
        website: nullableTrim(input.website),
        industry: nullableTrim(input.industry),
        source: input.source ?? 'api',
        customAttributes: input.customAttributes ?? {},
      })
      .returning()
    return row
  } catch (err) {
    translateUniqueError(err)
  }
}

export async function updateCompany(id: CompanyId, input: UpdateCompanyInput): Promise<Company> {
  const updateData: Partial<typeof companies.$inferInsert> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ValidationError('VALIDATION_ERROR', 'Company name cannot be empty')
    updateData.name = name
  }
  if (input.domain !== undefined) updateData.domain = nullableTrim(input.domain)
  if (input.externalId !== undefined) updateData.externalId = nullableTrim(input.externalId)
  if (input.plan !== undefined) updateData.plan = nullableTrim(input.plan)
  if (input.mrrCents !== undefined) updateData.mrrCents = input.mrrCents
  if (input.size !== undefined) updateData.size = nullableTrim(input.size)
  if (input.website !== undefined) updateData.website = nullableTrim(input.website)
  if (input.industry !== undefined) updateData.industry = nullableTrim(input.industry)
  if (input.customAttributes !== undefined) updateData.customAttributes = input.customAttributes

  if (Object.keys(updateData).length === 0) {
    return getCompany(id)
  }

  log.info({ company_id: id }, 'update company')
  try {
    const [row] = await db.update(companies).set(updateData).where(eq(companies.id, id)).returning()
    if (!row) {
      throw new NotFoundError('COMPANY_NOT_FOUND', `Company with ID ${id} not found`)
    }
    return row
  } catch (err) {
    if (err instanceof NotFoundError) throw err
    translateUniqueError(err)
  }
}

export async function deleteCompany(id: CompanyId): Promise<void> {
  log.info({ company_id: id }, 'delete company')
  // FK is ON DELETE SET NULL, so people are detached rather than orphaned.
  const rows = await db
    .delete(companies)
    .where(eq(companies.id, id))
    .returning({ id: companies.id })
  if (rows.length === 0) {
    throw new NotFoundError('COMPANY_NOT_FOUND', `Company with ID ${id} not found`)
  }
}

export async function getCompany(id: CompanyId): Promise<Company> {
  const row = await db.query.companies.findFirst({ where: eq(companies.id, id) })
  if (!row) {
    throw new NotFoundError('COMPANY_NOT_FOUND', `Company with ID ${id} not found`)
  }
  return row
}

/** One jsonb predicate over companies.custom_attributes — same operator set as
 *  the People directory's metadata filters so the two tabs behave alike. */
function attrConditionSql(attr: CompanyAttrFilter): ReturnType<typeof sql> | null {
  const jsonVal = sql`(${companies.customAttributes}::jsonb->>${attr.key})`
  switch (attr.op) {
    case 'eq':
      return sql`${jsonVal} = ${attr.value}`
    case 'neq':
      return sql`${jsonVal} != ${attr.value}`
    case 'contains':
      return sql`${jsonVal} ILIKE ${'%' + attr.value + '%'}`
    case 'starts_with':
      return sql`${jsonVal} ILIKE ${attr.value + '%'}`
    case 'ends_with':
      return sql`${jsonVal} ILIKE ${'%' + attr.value}`
    case 'gt':
      return sql`(${jsonVal})::numeric > ${Number(attr.value)}`
    case 'gte':
      return sql`(${jsonVal})::numeric >= ${Number(attr.value)}`
    case 'lt':
      return sql`(${jsonVal})::numeric < ${Number(attr.value)}`
    case 'lte':
      return sql`(${jsonVal})::numeric <= ${Number(attr.value)}`
    case 'is_set':
      return sql`${jsonVal} IS NOT NULL`
    case 'is_not_set':
      return sql`${jsonVal} IS NULL`
    default:
      return null
  }
}

const MRR_OPERATOR_SQL = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const

/** Standard columns the directory may filter with string operators. */
const FILTERABLE_COLUMNS = {
  source: () => companies.source,
  size: () => companies.size,
  website: () => companies.website,
  industry: () => companies.industry,
} as const

/** One string predicate over a whitelisted standard column. */
function columnConditionSql(field: CompanyAttrFilter): ReturnType<typeof sql> | null {
  const column = FILTERABLE_COLUMNS[field.key as keyof typeof FILTERABLE_COLUMNS]?.()
  if (!column) return null
  switch (field.op) {
    case 'eq':
      return sql`LOWER(${column}) = LOWER(${field.value})`
    case 'neq':
      return sql`(${column} IS NULL OR LOWER(${column}) != LOWER(${field.value}))`
    case 'contains':
      return sql`${column} ILIKE ${'%' + field.value + '%'}`
    case 'is_set':
      return sql`${column} IS NOT NULL`
    case 'is_not_set':
      return sql`${column} IS NULL`
    default:
      return null
  }
}

/** List companies with their linked-people counts, ordered by name. */
export async function listCompanies(
  filter: CompanyListFilter = {}
): Promise<CompanyWithMemberCount[]> {
  const conditions: ReturnType<typeof sql>[] = []

  const search = filter.search?.trim()
  if (search) {
    const pattern = `%${search}%`
    conditions.push(
      sql`(${companies.name} ILIKE ${pattern} OR ${companies.domain} ILIKE ${pattern})`
    )
  }
  if (filter.plan?.trim()) {
    conditions.push(sql`LOWER(${companies.plan}) = LOWER(${filter.plan.trim()})`)
  }
  if (filter.mrr) {
    const op = MRR_OPERATOR_SQL[filter.mrr.op]
    // The filter speaks whole currency units (what agents see in the list);
    // the column stores minor units.
    conditions.push(sql`(${companies.mrrCents} / 100.0) ${sql.raw(op)} ${Number(filter.mrr.value)}`)
  }
  for (const field of filter.fields ?? []) {
    const cond = columnConditionSql(field)
    if (cond) conditions.push(cond)
  }
  for (const attr of filter.attrs ?? []) {
    const cond = attrConditionSql(attr)
    if (cond) conditions.push(cond)
  }

  const rows = await db
    .select({
      company: companies,
      memberCount: sql<number>`count(${principal.id})::int`.as('member_count'),
    })
    .from(companies)
    .leftJoin(principal, eq(principal.companyId, companies.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(companies.id)
    .orderBy(companies.name)
  return rows.map((r) => ({ ...r.company, memberCount: r.memberCount }))
}

/** The people attached to a company, oldest first (directory profile roster). */
export async function listMembers(companyId: CompanyId): Promise<CompanyMember[]> {
  const rows = await db
    .select({
      principalId: principal.id,
      displayName: principal.displayName,
      email: user.email,
      type: principal.type,
      createdAt: principal.createdAt,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.companyId, companyId))
    .orderBy(asc(principal.createdAt))
  return rows.map((r) => ({ ...r, email: realEmail(r.email) }))
}

/** Activity rollup counts: member conversations + tickets linked to the company. */
export async function getActivityCounts(companyId: CompanyId): Promise<CompanyActivityCounts> {
  const [conv] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .where(eq(principal.companyId, companyId))
  const [tick] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(eq(tickets.companyId, companyId), isNull(tickets.deletedAt)))
  return { conversations: conv?.count ?? 0, tickets: tick?.count ?? 0 }
}

/** The company a person belongs to, or null. */
export async function getForPrincipal(principalId: PrincipalId): Promise<Company | null> {
  const [row] = await db
    .select({ company: companies })
    .from(principal)
    .innerJoin(companies, eq(companies.id, principal.companyId))
    .where(eq(principal.id, principalId))
    .limit(1)
  return row?.company ?? null
}

/**
 * Inbox-sidebar qualification (§K2): committing a company name for a contact
 * creates-or-attaches by case-insensitive name match. A new record is born
 * with `source: 'manual'`; a matched record keeps its source, and any
 * qualification fields the agent provided are written through (company
 * attribute edits are global — every attached person sees them).
 */
export async function qualifyCompany(input: QualifyCompanyInput): Promise<Company> {
  const name = input.name?.trim()
  if (!name) {
    throw new ValidationError('VALIDATION_ERROR', 'Company name is required')
  }

  const [match] = await db
    .select()
    .from(companies)
    .where(sql`LOWER(${companies.name}) = LOWER(${name})`)
    .orderBy(asc(companies.createdAt))
    .limit(1)

  let company: Company
  if (match) {
    const updates: UpdateCompanyInput = {}
    if (nullableTrim(input.size)) updates.size = input.size
    if (nullableTrim(input.website)) updates.website = input.website
    if (nullableTrim(input.industry)) updates.industry = input.industry
    company =
      Object.keys(updates).length > 0
        ? await updateCompany(match.id as CompanyId, updates)
        : match
  } else {
    company = await createCompany({
      name,
      size: input.size,
      website: input.website,
      industry: input.industry,
      source: 'manual',
    })
  }

  await attachPrincipal(company.id as CompanyId, input.principalId as PrincipalId)
  return company
}

/** Link a person to a company (verifying the company exists first). */
export async function attachPrincipal(
  companyId: CompanyId,
  principalId: PrincipalId
): Promise<void> {
  await getCompany(companyId)
  log.info({ company_id: companyId, principal_id: principalId }, 'attach principal to company')
  await db.update(principal).set({ companyId }).where(eq(principal.id, principalId))
}

/** Unlink a person from their company. */
export async function detachPrincipal(principalId: PrincipalId): Promise<void> {
  log.info({ principal_id: principalId }, 'detach principal from company')
  await db.update(principal).set({ companyId: null }).where(eq(principal.id, principalId))
}
