/**
 * Companies service (support platform §4.4): CRUD plus the person-to-company
 * links that give agents plan / MRR context in the inbox.
 *
 * `domain` is unique case-insensitively (enforced by the LOWER functional index
 * in migration 0140); `external_id` is unique when present. The DB indexes are
 * the source of truth, so a duplicate surfaces as a ConflictError from the
 * unique-violation handler rather than a racy pre-check.
 */
import { db, eq, sql, companies, principal } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { NotFoundError, ValidationError, ConflictError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import type {
  Company,
  CompanyId,
  CompanyWithMemberCount,
  CreateCompanyInput,
  UpdateCompanyInput,
} from './company.types'

const log = logger.child({ component: 'companies' })

/** Trim to a value or null (empty strings become null so partial indexes skip them). */
function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Map a Postgres unique violation on companies onto a typed ConflictError. */
function translateUniqueError(err: unknown): never {
  // Drizzle wraps the driver error; the pg fields live on `cause`.
  const pgErr = (err as { cause?: unknown }).cause ?? err
  const e = pgErr as {
    code?: string
    constraint?: string
    constraint_name?: string
    detail?: string
  }
  if (e.code === '23505') {
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

/** List every company with its linked-people count, ordered by name. */
export async function listCompanies(): Promise<CompanyWithMemberCount[]> {
  const rows = await db
    .select({
      company: companies,
      memberCount: sql<number>`count(${principal.id})::int`.as('member_count'),
    })
    .from(companies)
    .leftJoin(principal, eq(principal.companyId, companies.id))
    .groupBy(companies.id)
    .orderBy(companies.name)
  return rows.map((r) => ({ ...r.company, memberCount: r.memberCount }))
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
