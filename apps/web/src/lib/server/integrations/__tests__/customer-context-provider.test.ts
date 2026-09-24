/**
 * A customer-context lookup can only be answered by an active integration
 * whose definition provides the `context` capability and that holds
 * credentials. `hasCustomerContextProvider` answers that without calling out,
 * so the admin post modal can skip the lookup when nothing could answer it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const activeRows = vi.fn()
vi.mock('@/lib/server/db', () => ({
  db: { select: () => ({ from: () => ({ where: () => activeRows() }) }) },
  integrations: { status: 'status' },
  eq: vi.fn(),
}))

const context = vi.fn()
vi.mock('../index', () => ({
  getIntegration: (type: string) =>
    ({ hubspot: { context }, zendesk: { context }, linear: {} })[type],
}))

vi.mock('../token-refresh', () => ({
  withIntegrationReadAuth: vi.fn(),
}))

const { hasCustomerContextProvider } = await import('../context')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasCustomerContextProvider', () => {
  it('is false with no active integrations', async () => {
    activeRows.mockResolvedValueOnce([])
    await expect(hasCustomerContextProvider()).resolves.toBe(false)
  })

  it('is false when no active integration provides context', async () => {
    activeRows.mockResolvedValueOnce([{ integrationType: 'linear', secrets: 'sealed' }])
    await expect(hasCustomerContextProvider()).resolves.toBe(false)
  })

  it('is false when the context provider holds no credentials', async () => {
    activeRows.mockResolvedValueOnce([{ integrationType: 'hubspot', secrets: null }])
    await expect(hasCustomerContextProvider()).resolves.toBe(false)
  })

  it('is true when an active, connected integration provides context', async () => {
    activeRows.mockResolvedValueOnce([
      { integrationType: 'linear', secrets: 'sealed' },
      { integrationType: 'zendesk', secrets: 'sealed' },
    ])
    await expect(hasCustomerContextProvider()).resolves.toBe(true)
    expect(context).not.toHaveBeenCalled()
  })
})
