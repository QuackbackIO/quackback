import { createFileRoute, Navigate, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/ui/back-link'
import { EmptyState } from '@/components/shared/empty-state'
import { VisitorConversationThread } from '@/components/shared/conversation/visitor-conversation-thread'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import { getConversationPresenceFn } from '@/lib/server/functions/conversation'
import {
  CHAT_PRESENCE_POLL_MS,
  type ConversationPresence,
} from '@/lib/shared/conversation/presence'
import {
  PORTAL_CHAT_PRESENCE_QUERY_KEY,
  PORTAL_MY_CONVERSATIONS_QUERY_KEY,
} from '@/lib/client/queries/portal-support'

export const Route = createFileRoute('/_portal/support/$conversationId')({
  component: SupportThreadPage,
})

const OFFLINE: ConversationPresence = {
  agentsOnline: false,
  withinOfficeHours: null,
  nextOpenAt: null,
}

function SupportThreadPage() {
  const intl = useIntl()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { conversationId } = Route.useParams()
  const { session, settings } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()
  const { upload } = usePortalImageUpload()

  const supportEnabled =
    !!settings?.featureFlags?.supportInbox && !!settings?.portalConfig?.support?.enabled

  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  // Team availability for the presence strip — portal twin of the widget's
  // shared presence query (cookie-authed, so no headers needed).
  const presenceQuery = useQuery({
    queryKey: PORTAL_CHAT_PRESENCE_QUERY_KEY,
    queryFn: () => getConversationPresenceFn(),
    enabled: supportEnabled && isLoggedIn,
    refetchInterval: CHAT_PRESENCE_POLL_MS,
    staleTime: CHAT_PRESENCE_POLL_MS,
  })

  // The first send creates the thread: move /support/new → /support/<id> so a
  // refresh resumes the same conversation, and refresh the list + badge.
  const onConversationStarted = useCallback(
    (id: ConversationId) => {
      void queryClient.invalidateQueries({ queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY })
      void navigate({
        to: '/support/$conversationId',
        params: { conversationId: id },
        replace: true,
      })
    },
    [navigate, queryClient]
  )

  if (!supportEnabled) {
    return <Navigate to="/" />
  }

  return (
    // Same container as the feedback/roadmap pages (max-w-6xl), sized to the
    // viewport so the thread fills the page instead of floating in a strip.
    <div className="mx-auto flex h-[calc(100dvh-7rem)] min-h-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-3 shrink-0">
        <BackLink to="/support">
          <FormattedMessage id="portal.support.back" defaultMessage="All conversations" />
        </BackLink>
      </div>

      {!isLoggedIn ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title={intl.formatMessage({
            id: 'portal.support.signIn.title',
            defaultMessage: 'Sign in to view your conversations',
          })}
          description={intl.formatMessage({
            id: 'portal.support.signIn.body',
            defaultMessage: 'Your support conversations are tied to your account.',
          })}
          action={
            authPopover ? (
              <Button onClick={() => authPopover.openAuthPopover({ mode: 'login' })}>
                <FormattedMessage id="portal.support.signIn.cta" defaultMessage="Log in" />
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <VisitorConversationThread
            // Remount when switching threads so per-thread state never bleeds.
            key={conversationId}
            conversationTarget={
              conversationId === 'new' ? 'new' : (conversationId as ConversationId)
            }
            linkPreviews={!!settings?.featureFlags?.linkPreviews}
            currentUser={user ? { name: user.name, avatarUrl: user.image } : null}
            uploadImage={upload}
            presence={presenceQuery.data ?? OFFLINE}
            embedOpenMode="navigate"
            onConversationStarted={onConversationStarted}
          />
        </div>
      )}
    </div>
  )
}
