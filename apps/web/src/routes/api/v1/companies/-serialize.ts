import type { CompanyWithMemberCount } from '@/lib/server/domains/companies/company.types'

/** The public wire shape of a company with its member count. */
export function serializeCompany(c: CompanyWithMemberCount): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    externalId: c.externalId,
    plan: c.plan,
    mrrCents: c.mrrCents,
    size: c.size,
    website: c.website,
    industry: c.industry,
    source: c.source,
    customAttributes: c.customAttributes,
    memberCount: c.memberCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}
