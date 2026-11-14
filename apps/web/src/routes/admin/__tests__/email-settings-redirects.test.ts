/**
 * Sending addresses live on Settings → Email, the support inbox on Support →
 * Channels → Email. Links to either (bells, alert emails, bookmarks) land on the
 * one of the two the person can open, instead of the sign-in page or General.
 */
import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type BeforeLoad = (ctx: Record<string, unknown>) => void
type RouteModule = { Route: { options: { beforeLoad?: BeforeLoad } } }

// Imported once, outside any test's timeout: a route module pulls in its page.
const ROUTES = {
  email: (await import('../settings.email')) as unknown as RouteModule,
  channels: (await import('../settings.channels_.email')) as unknown as RouteModule,
}

async function landing(
  module: 'email' | 'channels',
  permissions: string[],
  supportOn: boolean
): Promise<string | null> {
  const { Route } = ROUTES[module]
  try {
    Route.options.beforeLoad?.({
      context: {
        permissions,
        settings: { featureFlags: { supportInbox: supportOn, supportTickets: supportOn } },
      },
    })
  } catch (thrown) {
    return (thrown as { options: { to?: string } }).options.to ?? null
  }
  return null
}

const ADMIN = [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE]
const SUPPORT_LEAD = [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE]

describe('Settings → Email', () => {
  it('opens for an admin', async () => {
    expect(await landing('email', ADMIN, true)).toBeNull()
  })

  it('sends a support lead to the support inbox settings they manage', async () => {
    expect(await landing('email', SUPPORT_LEAD, true)).toBe('/admin/settings/channels/email')
  })
})

describe('Support → Channels → Email', () => {
  it('opens while Support is on', async () => {
    expect(await landing('channels', ADMIN, true)).toBeNull()
  })

  it('sends an admin to Settings → Email while Support is off', async () => {
    expect(await landing('channels', ADMIN, false)).toBe('/admin/settings/email')
  })

  it('sends anyone else to General while Support is off', async () => {
    expect(await landing('channels', SUPPORT_LEAD, false)).toBe('/admin/settings/general')
  })
})
