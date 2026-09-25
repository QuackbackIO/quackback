/**
 * Settings pages warm, from their loaders, the reads their content makes on
 * first paint, so each renders complete from the document and the browser
 * fetches nothing more for it after hydration. A read the viewer's
 * permissions or plan don't cover is left out.
 */
import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const { entitled } = vi.hoisted(() => ({ entitled: { current: true } }))
vi.mock('@/lib/server/functions/entitlement-status', () => ({
  hasEntitlementFn: vi.fn(async () => entitled.current),
  listEntitlementsFn: vi.fn(async () => ({ sso: false, auditLog: false })),
}))

const { Route: MacrosRoute } = await import('../admin/settings.macros')
const { Route: SlaRoute } = await import('../admin/settings.sla')
const { Route: ChangelogRoute } = await import('../admin/settings.changelog')
const { Route: ImportsRoute } = await import('../admin/settings.imports')
const { Route: AuthenticationRoute } = await import('../admin/settings.security.authentication')

type LoaderFn = (ctx: {
  context: Record<string, unknown>
  location?: { search: Record<string, unknown> }
}) => Promise<unknown>
const loaderOf = (route: unknown) => (route as { options: { loader: LoaderFn } }).options.loader

async function warmedKeys(
  route: unknown,
  permissions: PermissionKey[],
  search: Record<string, unknown> = {}
) {
  const keys: string[] = []
  const queryClient = {
    ensureQueryData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
      keys.push(JSON.stringify(opts.queryKey))
      return Promise.resolve(undefined)
    }),
  }
  await loaderOf(route)({
    context: { queryClient, permissions, billingEnabled: false },
    location: { search },
  })
  return keys
}

const key = (...parts: string[]) => JSON.stringify(parts)

describe('settings page loaders', () => {
  it('macros: warms the macro library when the plan includes it', async () => {
    entitled.current = true
    expect(await warmedKeys(MacrosRoute, [PERMISSIONS.CONVERSATION_MANAGE])).toContain(
      key('macros', 'all')
    )
    entitled.current = false
    expect(await warmedKeys(MacrosRoute, [PERMISSIONS.CONVERSATION_MANAGE])).not.toContain(
      key('macros', 'all')
    )
  })

  it('SLA: warms the office hours the policies are measured against', async () => {
    expect(await warmedKeys(SlaRoute, [PERMISSIONS.SLA_MANAGE])).toEqual(
      expect.arrayContaining([
        key('settings', 'slaPolicies'),
        key('settings', 'defaultSlaPolicy'),
        key('settings', 'slaOfficeHours'),
      ])
    )
  })

  it('changelog: warms the segments its labels are gated to, with segment.view only', async () => {
    const withView = await warmedKeys(ChangelogRoute, [
      PERMISSIONS.CHANGELOG_MANAGE,
      PERMISSIONS.SEGMENT_VIEW,
    ])
    expect(withView).toContain(key('admin', 'segments'))

    const without = await warmedKeys(ChangelogRoute, [PERMISSIONS.CHANGELOG_MANAGE])
    expect(without).not.toContain(key('admin', 'segments'))
  })

  it('imports: warms the CSV import board picker', async () => {
    expect(await warmedKeys(ImportsRoute, [PERMISSIONS.SETTINGS_MANAGE])).toContain(
      key('admin', 'boards')
    )
  })

  it('access and security: warms the portal access tab segments, with segment.view only', async () => {
    const perms = [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.SEGMENT_VIEW]
    expect(await warmedKeys(AuthenticationRoute, perms)).toContain(key('admin', 'segments'))
    expect(await warmedKeys(AuthenticationRoute, perms, { tab: 'portal-access' })).toContain(
      key('admin', 'segments')
    )
    expect(await warmedKeys(AuthenticationRoute, perms, { tab: 'sign-in' })).not.toContain(
      key('admin', 'segments')
    )
    expect(await warmedKeys(AuthenticationRoute, [PERMISSIONS.AUTH_MANAGE])).not.toContain(
      key('admin', 'segments')
    )
  })
})
