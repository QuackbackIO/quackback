import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlaPolicyId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listSlaPoliciesFn: vi.fn(),
  getSlaPolicyFn: vi.fn(),
  listEscalationRulesFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/sla', () => ({
  listSlaPoliciesFn: (input: unknown) => mocks.listSlaPoliciesFn(input),
  getSlaPolicyFn: (input: unknown) => mocks.getSlaPolicyFn(input),
  listEscalationRulesFn: (input: unknown) => mocks.listEscalationRulesFn(input),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
}))

import { slaQueries } from '../sla'

const policyId = 'sla_pol_1' as SlaPolicyId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('slaQueries.policies', () => {
  it('defaults to an empty params object and forwards it', async () => {
    const options = slaQueries.policies()
    expect(options.queryKey).toEqual(['sla', 'policies', {}])
    expect(options.staleTime).toBe(30_000)

    mocks.listSlaPoliciesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listSlaPoliciesFn).toHaveBeenCalledWith({ data: {} })
  })

  it('forwards includeArchived when provided', async () => {
    const options = slaQueries.policies({ includeArchived: true })
    expect(options.queryKey).toEqual(['sla', 'policies', { includeArchived: true }])

    mocks.listSlaPoliciesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listSlaPoliciesFn).toHaveBeenCalledWith({ data: { includeArchived: true } })
  })
})

describe('slaQueries.policy', () => {
  it('builds the policy query and calls getSlaPolicyFn', async () => {
    const options = slaQueries.policy(policyId)
    expect(options.queryKey).toEqual(['sla', 'policy', policyId])

    mocks.getSlaPolicyFn.mockResolvedValueOnce({ id: policyId })
    await options.queryFn!({} as never)

    expect(mocks.getSlaPolicyFn).toHaveBeenCalledWith({ data: { id: policyId } })
  })
})

describe('slaQueries.escalations', () => {
  it('builds the escalations query and calls listEscalationRulesFn', async () => {
    const options = slaQueries.escalations(policyId)
    expect(options.queryKey).toEqual(['sla', 'escalations', policyId])

    mocks.listEscalationRulesFn.mockResolvedValueOnce([])
    await options.queryFn!({} as never)

    expect(mocks.listEscalationRulesFn).toHaveBeenCalledWith({ data: { policyId } })
  })
})
