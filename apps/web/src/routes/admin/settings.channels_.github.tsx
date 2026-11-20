import { createFileRoute, redirect } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { GitHubChannelPage } from '@/components/admin/settings/github-channel-page'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/channels_/github')({
  head: adminPageHead('GitHub channel settings'),
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    const { permissions, queryClient } = context
    assertSettingsPageAccess(permissions, '/admin/settings/channels/github')
    // The connection status renders the page (its read takes channel_account.manage,
    // which the page's gate holds); warm it into the document.
    const { githubChannelStatusQuery: githubStatus } =
      await import('@/integrations/github/ui/github-channel-status-query')
    await warmQuery(queryClient, githubStatus())
    return {}
  },
  component: GitHubChannelPage,
})
