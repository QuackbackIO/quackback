import { describe, it, expect } from 'vitest'
import { parseCompanyFilterParts, buildCompaniesExportUrl } from '../company-filters'

describe('parseCompanyFilterParts', () => {
  it('returns empty parts for undefined / empty input', () => {
    expect(parseCompanyFilterParts(undefined)).toEqual({})
    expect(parseCompanyFilterParts('')).toEqual({})
  })

  it('routes the plan reserved key to the plan column filter', () => {
    expect(parseCompanyFilterParts('plan:eq:Scale')).toEqual({ plan: 'Scale' })
  })

  it('parses mrr as a typed numeric predicate', () => {
    expect(parseCompanyFilterParts('mrr:gte:100')).toEqual({ mrr: { op: 'gte', value: 100 } })
  })

  it('drops an mrr predicate with a non-numeric value or unknown operator', () => {
    expect(parseCompanyFilterParts('mrr:gte:abc')).toEqual({})
    expect(parseCompanyFilterParts('mrr:contains:5')).toEqual({})
  })

  it('treats non-reserved keys as custom attribute predicates', () => {
    expect(parseCompanyFilterParts('region:eq:eu')).toEqual({
      attrs: [{ key: 'region', op: 'eq', value: 'eu' }],
    })
  })

  it('routes the standard-column keys (source, size, website, industry) to column predicates', () => {
    expect(parseCompanyFilterParts('source:eq:manual,industry:contains:fin')).toEqual({
      fields: [
        { key: 'source', op: 'eq', value: 'manual' },
        { key: 'industry', op: 'contains', value: 'fin' },
      ],
    })
  })

  it('parses mixed parts and preserves colons inside values', () => {
    expect(parseCompanyFilterParts('plan:eq:Scale,mrr:lt:500,ref:eq:a:b')).toEqual({
      plan: 'Scale',
      mrr: { op: 'lt', value: 500 },
      attrs: [{ key: 'ref', op: 'eq', value: 'a:b' }],
    })
  })

  it('skips malformed parts', () => {
    expect(parseCompanyFilterParts('nocolon,plan')).toEqual({})
  })
})

describe('buildCompaniesExportUrl', () => {
  it('returns the bare endpoint with no filters', () => {
    expect(buildCompaniesExportUrl(undefined)).toBe('/api/export/companies')
  })

  it('encodes search and decomposed filter parts', () => {
    const url = buildCompaniesExportUrl(
      'acme',
      'plan:eq:Scale,mrr:gte:100,region:eq:eu,source:eq:manual'
    )
    const parsed = new URL(url, 'http://x')
    expect(parsed.pathname).toBe('/api/export/companies')
    expect(parsed.searchParams.get('search')).toBe('acme')
    expect(parsed.searchParams.get('plan')).toBe('Scale')
    expect(parsed.searchParams.get('mrr')).toBe('gte:100')
    expect(parsed.searchParams.get('attrs')).toBe('region:eq:eu')
    expect(parsed.searchParams.get('fields')).toBe('source:eq:manual')
  })
})
