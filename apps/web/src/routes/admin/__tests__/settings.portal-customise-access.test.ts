/**
 * The Customise page needs settings.branding, like Settings > Portal. Its
 * loader reads the Help Center home only for someone who can manage the Help
 * Center: everyone else gets the page without that section, not a 403.
 */
import { describe, expect, it, vi } from 'vitest'

const { ensured } = vi.hoisted(() => ({ ensured: [] as string[] }))

vi.mock('@/lib/client/queries/read-batch', () => ({
  readBatch: () => (options: { queryKey: unknown[] }) => {
    ensured.push(options.queryKey.join('.'))
    return Promise.resolve(null)
  },
}))
vi.mock('@/lib/client/queries/billing', () => ({
  ensureBillingCatalogue: () => Promise.resolve(),
}))

const { Route } = await import('../settings_.portal.customise')

type Args = { context: { permissions?: string[]; queryClient?: unknown; billingEnabled?: boolean } }
const options = (
  Route as unknown as {
    options: { beforeLoad?: (args: Args) => unknown; loader?: (args: Args) => Promise<unknown> }
  }
).options

function denied(permissions?: string[]) {
  try {
    options.beforeLoad?.({ context: { permissions } })
  } catch {
    return true
  }
  return false
}

describe('/admin/settings/portal/customise access', () => {
  it('denies a teammate without settings.branding', () => {
    expect(denied(['settings.manage'])).toBe(true)
    expect(denied(undefined)).toBe(true)
  })

  it('admits a teammate with settings.branding', () => {
    expect(denied(['settings.branding'])).toBe(false)
  })

  it('reads the Help Center home only with help_center.manage', async () => {
    ensured.length = 0
    await options.loader?.({ context: { permissions: ['settings.branding'], queryClient: {} } })
    expect(ensured).toContain('settings.portalConfig.page')
    expect(ensured).not.toContain('settings.helpCenterConfig')

    ensured.length = 0
    await options.loader?.({
      context: { permissions: ['settings.branding', 'help_center.manage'], queryClient: {} },
    })
    expect(ensured).toContain('settings.helpCenterConfig')
  })

  // What is a website is decided by useImportDeepLink, which loads with the
  // editor; the route's own check ships in every page's script, so it stays small.
  it('keeps a string in ?import for the editor to judge, and drops anything else', () => {
    const validate = (
      Route as unknown as {
        options: { validateSearch: (raw: Record<string, unknown>) => { import?: string } }
      }
    ).options.validateSearch
    expect(validate({ import: 'acme.example' })).toEqual({ import: 'acme.example' })
    expect(validate({})).toEqual({ import: undefined })
    expect(validate({ import: 'javascript:alert(1)' })).toEqual({ import: 'javascript:alert(1)' })
    for (const bad of [42, ['acme.example'], null, { site: 'acme.example' }])
      expect(validate({ import: bad }), String(bad)).toEqual({ import: undefined })
  })
})
