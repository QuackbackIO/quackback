/**
 * A company a teammate creates in the admin is a manual company, not one
 * that arrived over the API.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let schema: { parse: (v: unknown) => unknown } | null = null
    let handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!handler) throw new Error('handler not registered')
      return handler({ data: schema ? schema.parse(args?.data) : args?.data })
    }
    fn.validator = (s: { parse: (v: unknown) => unknown }) => {
      schema = s
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      handler = h
      return fn
    }
    return fn
  },
}))

const m = vi.hoisted(() => ({ createCompany: vi.fn() }))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/server/domains/companies', () => ({ createCompany: m.createCompany }))

import { createCompanyFn } from '../companies'

describe('createCompanyFn', () => {
  it('creates the company as manual', async () => {
    const now = new Date()
    m.createCompany.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 'company_1',
      domain: null,
      externalId: null,
      plan: null,
      mrrCents: null,
      size: null,
      website: null,
      industry: null,
      customAttributes: {},
      createdAt: now,
      updatedAt: now,
      ...input,
    }))

    const created = await createCompanyFn({ data: { name: 'Acme' } })

    expect(m.createCompany).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme', source: 'manual' })
    )
    expect(created).toMatchObject({ source: 'manual' })
  })
})
