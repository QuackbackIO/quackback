/**
 * Companies-directory filter encoding.
 *
 * The Companies tab stores its filters in one URL param (`companyAttrs`) using
 * the same "key:op:value" comma-joined format as the People tab's customAttrs.
 * Reserved keys route to standard company columns; everything else is a
 * custom-attribute predicate over the jsonb blob. Client-safe (no DB imports).
 */

export interface CompanyMrrFilter {
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  value: number
}

export interface CompanyFilterParts {
  plan?: string
  mrr?: CompanyMrrFilter
  /** Predicates over the other standard columns (source, size, website, industry). */
  fields?: { key: string; op: string; value: string }[]
  attrs?: { key: string; op: string; value: string }[]
}

const MRR_OPS = new Set(['gt', 'gte', 'lt', 'lte', 'eq'])

/** Standard columns filterable with string operators (beyond plan/mrr). */
export const COMPANY_COLUMN_FILTER_KEYS = new Set(['source', 'size', 'website', 'industry'])

/** Keys that map to standard company columns rather than custom attributes. */
export const COMPANY_RESERVED_FILTER_KEYS = new Set([
  'plan',
  'mrr',
  ...COMPANY_COLUMN_FILTER_KEYS,
])

/** Decode the `companyAttrs` URL param into the server filter shape. */
export function parseCompanyFilterParts(encoded?: string): CompanyFilterParts {
  const parts: CompanyFilterParts = {}
  if (!encoded) return parts

  const fields: { key: string; op: string; value: string }[] = []
  const attrs: { key: string; op: string; value: string }[] = []
  for (const part of encoded.split(',').filter(Boolean)) {
    const [key, op, ...rest] = part.split(':')
    if (!key || !op) continue
    const value = rest.join(':')
    if (key === 'plan') {
      parts.plan = value
    } else if (key === 'mrr') {
      const num = Number(value)
      if (MRR_OPS.has(op) && value !== '' && !Number.isNaN(num)) {
        parts.mrr = { op: op as CompanyMrrFilter['op'], value: num }
      }
    } else if (COMPANY_COLUMN_FILTER_KEYS.has(key)) {
      fields.push({ key, op, value })
    } else {
      attrs.push({ key, op, value })
    }
  }
  if (fields.length > 0) parts.fields = fields
  if (attrs.length > 0) parts.attrs = attrs
  return parts
}

/** Build the /api/export/companies URL for the current filtered view. */
export function buildCompaniesExportUrl(search: string | undefined, encoded?: string): string {
  const parts = parseCompanyFilterParts(encoded)
  const params = new URLSearchParams()
  if (search?.trim()) params.set('search', search.trim())
  if (parts.plan) params.set('plan', parts.plan)
  if (parts.mrr) params.set('mrr', `${parts.mrr.op}:${parts.mrr.value}`)
  if (parts.fields && parts.fields.length > 0) {
    params.set('fields', parts.fields.map((f) => `${f.key}:${f.op}:${f.value}`).join(','))
  }
  if (parts.attrs && parts.attrs.length > 0) {
    params.set('attrs', parts.attrs.map((a) => `${a.key}:${a.op}:${a.value}`).join(','))
  }
  const qs = params.toString()
  return qs ? `/api/export/companies?${qs}` : '/api/export/companies'
}
