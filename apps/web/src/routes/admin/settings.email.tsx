import { createFileRoute } from '@tanstack/react-router'
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
