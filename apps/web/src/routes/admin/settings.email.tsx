import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { WorkspaceEmailPage } from '@/components/admin/settings/workspace-email-page'
import { readBatch } from '@/lib/client/queries/read-batch'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

/**
 * Settings → Email: how this workspace sends. Not behind any product, since
 * feedback, changelog and status email send whether or not Support is on.
 */
export const Route = createFileRoute('/admin/settings/email')({
  head: adminPageHead('Email settings'),
  // Someone who runs the support inbox but not the workspace's sending lands
  // on the inbox settings they can change, not on the sign-in page: links to
  // sending domains reach them from bells and emails sent before this page.
  beforeLoad: ({ context }) => {
    const permissions = context.permissions ?? []
    if (
      !permissions.includes(EMAIL_SENDING_PERMISSION) &&
      permissions.includes(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE) &&
      isProductEnabled(context.settings?.featureFlags, 'support')
    ) {
      throw redirect({ to: '/admin/settings/channels/email' })
    }
  },
  loader: async ({ context }) => {
    const { permissions, queryClient } = context
    assertRoutePermission(permissions, EMAIL_SENDING_PERMISSION)
    const [{ channelSettingsQueries: channels }, { emailChannelConfigQuery }] = await Promise.all([
      import('@/lib/client/queries/channel-settings'),
      import('@/lib/client/queries/channel-accounts'),
    ])
    const ensure = readBatch(queryClient)
    await Promise.all([
      warmQuery(ensure, emailChannelConfigQuery()),
      warmQuery(ensure, channels.emailStatus()),
    ])
    return {}
  },
  component: WorkspaceEmailPage,
})
