/**
 * Companies exporter — same columns as the interactive /api/export/companies
 * route. listCompanies has no paging; companies are few enough that a single
 * fetch is fine (the exporter interface still treats it as one page).
 */
import { listCompanies } from '@/lib/server/domains/companies'
import type { CompanyWithMemberCount } from '@/lib/server/domains/companies'
import { escapeCSV } from '@/lib/server/utils/csv'
import type { EntityExporter } from '../types'

async function fetchCompanies(offset: number): Promise<CompanyWithMemberCount[]> {
  if (offset > 0) return []
  return listCompanies({})
}

export const companiesExporter: EntityExporter<CompanyWithMemberCount> = {
  key: 'companies',
  fileName: 'companies.csv',
  pageSize: Number.MAX_SAFE_INTEGER, // single unpaged fetch; see fetchCompanies
  header: 'name,domain,external_id,plan,monthly_spend,people_count,created_at',
  fetchPage: fetchCompanies,
  serialize: (c) =>
    [
      escapeCSV(c.name),
      escapeCSV(c.domain ?? ''),
      escapeCSV(c.externalId ?? ''),
      escapeCSV(c.plan ?? ''),
      c.mrrCents != null ? (c.mrrCents / 100).toFixed(2) : '',
      String(c.memberCount),
      c.createdAt.toISOString(),
    ].join(','),
}
