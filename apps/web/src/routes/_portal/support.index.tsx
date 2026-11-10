import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { SupportPageView } from '@/components/portal/support/support-page-view'
import { getMyConversationsFn } from '@/lib/server/functions/conversation'
import { PORTAL_MY_CONVERSATIONS_QUERY_KEY } from '@/lib/client/queries/portal-support'
import {
  isPortalChatStartEnabled,
  isPortalSupportSurfaceEnabled,
} from '@/lib/shared/support-surfaces'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'

export const Route = createFileRoute('/_portal/support/')({
  component: SupportListPage,
})

/** The viewer's own conversations, once they are signed in and the surface is on. */
function SupportListPage() {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()

  const messengerEnabled = isPortalChatStartEnabled(settings?.featureFlags, settings?.portalConfig)
  const surfaceEnabled = isPortalSupportSurfaceEnabled(
    settings?.featureFlags,
    settings?.portalConfig
  )

  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  const { data, isLoading } = useQuery({
    queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY,
    queryFn: () => getMyConversationsFn(),
    enabled: surfaceEnabled && isLoggedIn,
    staleTime: 30_000,
  })

  if (!surfaceEnabled) {
    return <Navigate to={PORTAL_LANDING} />
  }

  return (
    <SupportPageView
      signedIn={isLoggedIn}
      loading={isLoading}
      messenger={messengerEnabled}
      conversations={data?.conversations ?? []}
      linkedTickets={data?.linkedTickets ?? {}}
    />
  )
}
