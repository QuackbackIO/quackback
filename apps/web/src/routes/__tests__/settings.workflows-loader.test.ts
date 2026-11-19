/**
 * The Workflows page warms the auto-assign switch's read for routing.manage
 * holders only, so the switch renders from the document for them and a
 * viewer without the permission never asks the server for it.
 */
import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

vi.mock('@/lib/server/functions/entitlement-status', () => ({
  hasEntitlementFn: vi.fn(async () => true),
}))
vi.mock('@/lib/client/queries/billing', () => ({
  ensureBillingCatalogue: vi.fn(async () => undefined),
}))

const { Route } = await import('../admin/settings.workflows')

type LoaderFn = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

async function warmedKeys(permissions: PermissionKey[], supportInbox = true) {
  const keys: string[] = []
  const queryClient = {
    ensureQueryData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
      keys.push(JSON.stringify(opts.queryKey))
      return Promise.resolve(undefined)
    }),
  }
  await loader({
    context: {
      queryClient,
      permissions,
      settings: { featureFlags: { supportInbox } },
      billingEnabled: false,
    },
  })
  return keys
}

const ROUTING_KEY = JSON.stringify(['settings', 'conversationRouting'])

describe('workflows settings loader', () => {
  it('warms the auto-assign switch for a routing.manage holder without settings.manage', async () => {
    const keys = await warmedKeys([PERMISSIONS.WORKFLOW_MANAGE, PERMISSIONS.ROUTING_MANAGE])
    expect(keys).toContain(ROUTING_KEY)
    expect(keys).toContain(JSON.stringify(['settings', 'workflowCloseSpam']))
  })

  it('leaves the switch out without routing.manage', async () => {
    const keys = await warmedKeys([PERMISSIONS.WORKFLOW_MANAGE, PERMISSIONS.SETTINGS_MANAGE])
    expect(keys).toContain(JSON.stringify(['settings', 'workflowCloseSpam']))
    expect(keys).not.toContain(ROUTING_KEY)
  })

  it('reads nothing a Support lead is refused, so the page opens for them', async () => {
    // fetchWidgetConfig requires settings.manage, which the Support lead
    // preset lacks; a loader that reads it throws Access denied for them.
    const keys = await warmedKeys(SYSTEM_ROLE_PERMISSIONS.support_lead)
    expect(SYSTEM_ROLE_PERMISSIONS.support_lead).not.toContain(PERMISSIONS.SETTINGS_MANAGE)
    expect(keys).not.toContain(JSON.stringify(['settings', 'widgetConfig']))
    expect(keys).toContain(ROUTING_KEY)
  })

  it('leaves the switch out when the support inbox is off', async () => {
    const keys = await warmedKeys([PERMISSIONS.ROUTING_MANAGE], false)
    expect(keys).not.toContain(ROUTING_KEY)
  })
})
