import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { GitHubChannelPage } from '@/components/admin/settings/github-channel-page'
import { warmQuery } from '@/lib/client/queries/warm-query'

export const Route = createFileRoute('/admin/settings/channels_/github')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    const { permissions, queryClient } = context
    assertRoutePermission(permissions, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
    // The connection status renders the page; warm it into the document when
    // the viewer holds settings.manage, which its read requires.
    if (permissions?.includes(PERMISSIONS.SETTINGS_MANAGE)) {
      const { githubChannelStatusQuery: githubStatus } =
        await import('@/integrations/github/ui/github-channel-status-query')
      await warmQuery(queryClient, githubStatus())
    }
    return {}
  },
  component: GitHubChannelPage,
})
