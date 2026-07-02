/**
 * Input/output types for the companies domain (support platform §4.4).
 */
import { companies } from '@/lib/server/db'

export type { CompanyId } from '@quackback/ids'

/** A company row, inferred from the schema (kept out of the shared db types pkg). */
export type Company = typeof companies.$inferSelect

export interface CreateCompanyInput {
  name: string
  domain?: string | null
  externalId?: string | null
  plan?: string | null
  mrrCents?: number | null
  customAttributes?: Record<string, unknown>
}

export interface UpdateCompanyInput {
  name?: string
  domain?: string | null
  externalId?: string | null
  plan?: string | null
  mrrCents?: number | null
  customAttributes?: Record<string, unknown>
}

/** A company plus the number of people linked to it (for the directory list). */
export interface CompanyWithMemberCount extends Company {
  memberCount: number
}
