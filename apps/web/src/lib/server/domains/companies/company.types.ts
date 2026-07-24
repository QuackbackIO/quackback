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
  size?: string | null
  website?: string | null
  industry?: string | null
  /** Record origin: 'api' (default) or 'manual' (agent qualification). */
  source?: 'api' | 'manual'
  customAttributes?: Record<string, unknown>
}

export interface UpdateCompanyInput {
  name?: string
  domain?: string | null
  externalId?: string | null
  plan?: string | null
  mrrCents?: number | null
  size?: string | null
  website?: string | null
  industry?: string | null
  customAttributes?: Record<string, unknown>
}

/** Inbox-sidebar qualification: create-or-attach by name for an unattached contact. */
export interface QualifyCompanyInput {
  principalId: string
  name: string
  size?: string | null
  website?: string | null
  industry?: string | null
}

/** A company plus the number of people linked to it (for the directory list). */
export interface CompanyWithMemberCount extends Company {
  memberCount: number
}

/** One custom-attribute predicate over the companies.custom_attributes jsonb. */
export interface CompanyAttrFilter {
  key: string
  op: string
  value: string
}

/** Directory filters. Mirrors the People-side list semantics (ILIKE search,
 *  typed jsonb predicates) so both tabs of /admin/users behave alike. */
export interface CompanyListFilter {
  /** Matches name or domain, case-insensitively. */
  search?: string
  /** Plan label, matched case-insensitively. */
  plan?: string
  /** Monthly spend in whole currency units, compared against mrr_cents / 100. */
  mrr?: { op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number }
  /** Standard-column predicates (whitelisted: source, size, website, industry). */
  fields?: CompanyAttrFilter[]
  /** Custom attribute predicates over the jsonb blob. */
  attrs?: CompanyAttrFilter[]
  /** Max rows to return (keyset page size). Defaults to DEFAULT_COMPANY_PAGE_SIZE. */
  limit?: number
  /** Keyset cursor: the previous page's last company id. */
  cursor?: string
}

/** One keyset page of companies plus the cursor for the next page. */
export interface CompanyListPage {
  items: CompanyWithMemberCount[]
  hasMore: boolean
  nextCursor: string | null
}

/** A person on a company's roster (directory profile members list). */
export interface CompanyMember {
  principalId: string
  displayName: string | null
  email: string | null
  type: string
  createdAt: Date
}

/** Activity rollup counts for the company profile. */
export interface CompanyActivityCounts {
  conversations: number
  tickets: number
}
