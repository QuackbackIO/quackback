/**
 * The Channels settings pages warm, from their loaders, every read their
 * cards make on first paint, so the pages render complete from the document
 * and the browser fetches nothing more for them after hydration. A read the
 * viewer's permissions don't cover is left to the card, as before.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { Route as HubRoute } from '../admin/settings.channels'
import { Route as EmailRoute } from '../admin/settings.channels_.email'
import { Route as GitHubRoute } from '../admin/settings.channels_.github'

type LoaderFn = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
const loaderOf = (route: unknown) => (route as { options: { loader: LoaderFn } }).options.loader

async function warmedKeys(route: unknown, permissions: PermissionKey[]) {
  const keys: string[] = []
  const queryClient = {
    ensureQueryData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
      keys.push(JSON.stringify(opts.queryKey))
      return Promise.resolve(undefined)
    }),
  }
  await loaderOf(route)({ context: { queryClient, permissions } })
  return keys
}

const key = (...parts: string[]) => JSON.stringify(parts)

describe('channels settings loaders', () => {
  it('hub: warms the configs, the email and GitHub status and the routing switch', async () => {
    const keys = await warmedKeys(HubRoute, [PERMISSIONS.SETTINGS_MANAGE])
    expect(keys).toEqual(
      expect.arrayContaining([
        key('settings', 'widgetConfig'),
        key('settings', 'portalConfig'),
        key('settings', 'email-channel-status'),
        key('settings', 'github-channel-status'),
        key('conversation-routing'),
      ])
    )
  })

  it('email: warms every card on the page', async () => {
    const keys = await warmedKeys(EmailRoute, [
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ])
    expect(keys).toEqual(
      expect.arrayContaining([
        key('settings', 'spamFilterConfig'),
        key('settings', 'email-channel-status'),
        key('email-channel-config'),
        key('email-auto-ack'),
        key('email-activity'),
      ])
    )
  })

  it('email: leaves the transport status to its card without settings.manage', async () => {
    const keys = await warmedKeys(EmailRoute, [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])
    expect(keys).not.toContain(key('settings', 'email-channel-status'))
    expect(keys).toContain(key('email-activity'))
  })

  it('GitHub: warms the connection status with settings.manage only', async () => {
    const withManage = await warmedKeys(GitHubRoute, [
      PERMISSIONS.CHANNEL_ACCOUNT_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ])
    expect(withManage).toContain(key('settings', 'github-channel-status'))

    const without = await warmedKeys(GitHubRoute, [PERMISSIONS.CHANNEL_ACCOUNT_MANAGE])
    expect(without).not.toContain(key('settings', 'github-channel-status'))
  })

  it('GitHub: the warmed status stays fresh for its row', () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
    const { staleTime } = client.defaultQueryOptions(githubChannelStatusQuery())
    expect(staleTime).toBe(30_000)
  })
})
