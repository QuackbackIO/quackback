import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/client/queries/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/queries/billing')>()
  return {
    ...actual,
    ensureBillingCatalogue: vi.fn(async () => null),
  }
})

const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
const { Route: settingsRoute } = await import('../settings')
const { Route: automationRoute } = await import('../automation')

describe('upgrade catalogue SSR prefetch', () => {
  it('settings and automation layouts warm the catalogue when billing is on', async () => {
    const queryClient = { ensureQueryData: vi.fn() }
    const context = {
      queryClient,
      billingEnabled: true,
      permissions: ['settings.manage', 'assistant.manage', 'workflow.manage'],
    }
    const runLoader = async (loader: unknown) => {
      if (typeof loader !== 'function') throw new Error('expected a function loader')
      await loader({ context })
    }
    await runLoader(settingsRoute.options.loader)
    await runLoader(automationRoute.options.loader)
    expect(ensureBillingCatalogue).toHaveBeenCalledWith(queryClient, true)
    expect(ensureBillingCatalogue).toHaveBeenCalledTimes(2)
  })
})
