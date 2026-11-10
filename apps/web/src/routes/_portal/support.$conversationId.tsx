import { createFileRoute, Navigate, useNavigate, useLoaderData } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useRef } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/ui/back-link'
import { EmptyState } from '@/components/shared/empty-state'
import { VisitorConversationThread } from '@/components/shared/conversation/visitor-conversation-thread'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { usePortalFileUpload } from '@/lib/client/hooks/use-file-upload'
import { getConversationPresenceFn } from '@/lib/server/functions/conversation'
import {
  CONVERSATION_PRESENCE_POLL_MS,
  type ConversationPresence,
} from '@/lib/shared/conversation/presence'
import {
  PORTAL_CONVERSATION_PRESENCE_QUERY_KEY,
  PORTAL_MY_CONVERSATIONS_QUERY_KEY,
} from '@/lib/client/queries/portal-support'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { usePageChoices } from '@/components/public/preview-draft-context'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PORTAL_LANDING } from '@/lib/shared/design/paths'

export const Route = createFileRoute('/_portal/support/$conversationId')({
  component: SupportThreadPage,
})

/** A help article suggested as a new request is written: enough to link to it. */
type SuggestedArticle = { urlId: number; slug: string; title: string }

/**
 * Help articles for a request being written, from the help center's search,
 * as the widget suggests them. Articles open in a new tab, so the words
 * written so far stay.
 */
function useArticleSuggestions(on: boolean) {
  const found = useRef(new Map<string, SuggestedArticle>())
  return useMemo(() => {
    if (!on) return undefined
    return {
      search: async (q: string, signal: AbortSignal) => {
        const params = new URLSearchParams({ q, limit: '3' })
        const res = await fetch(`/api/widget/kb-search?${params.toString()}`, { signal })
        if (!res.ok) return []
        const json = (await res.json()) as { data?: { articles?: SuggestedArticle[] } }
        const articles = json.data?.articles ?? []
        for (const article of articles) found.current.set(article.slug, article)
        return articles
      },
      onSelect: (slug: string) => {
        const article = found.current.get(slug)
        if (!article) return
        const path = hcArticlePath({ locale: DEFAULT_LOCALE, urlId: article.urlId, slug })
        window.open(path, '_blank', 'noopener')
      },
    }
  }, [on])
}

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
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const portalLoader = useLoaderData({ from: '/_portal' })
  const portalAvatar =
    portalLoader && 'initialUserData' in portalLoader
      ? (portalLoader.initialUserData?.avatarUrl ?? null)
      : null
  const authPopover = useAuthPopoverSafe()
  const { upload } = usePortalFileUpload()

  // Converged Messages: ticket pairs open here too, so a tickets-enabled
  // workspace keeps this route alive even with the messenger/portal-support
  // toggle off (email-first workspaces reply to their ticket threads here).
  const supportEnabled = isPortalSupportSurfaceEnabled(
    settings?.featureFlags,
    settings?.portalConfig
  )

  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  // A new request suggests help articles as it is written, while the design
  // asks for it and the help center is on.
  const suggest = usePageChoices().support.suggest
  const helpSearch = useArticleSuggestions(
    suggest && conversationId === 'new' && isProductEnabled(settings?.featureFlags, 'helpCenter')
  )

  // Team availability for the presence strip — portal twin of the widget's
  // shared presence query (cookie-authed, so no headers needed).
  const presenceQuery = useQuery({
    queryKey: PORTAL_CONVERSATION_PRESENCE_QUERY_KEY,
    queryFn: () => getConversationPresenceFn(),
    enabled: supportEnabled && isLoggedIn,
    refetchInterval: CONVERSATION_PRESENCE_POLL_MS,
    staleTime: CONVERSATION_PRESENCE_POLL_MS,
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
    return <Navigate to={PORTAL_LANDING} />
  }

  return (
    // Same container as the feedback/roadmap pages (the page width), sized to the
    // viewport, less the header and footer, so the thread fills the page
    // instead of floating in a strip.
    <div className="qb-page flex h-[calc(100dvh-7rem-var(--portal-footer-height,0px))] min-h-0 flex-col py-6">
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
            linkPreviews={!!settings?.featureFlags?.supportInbox}
            currentUser={user ? { name: user.name, avatarUrl: portalAvatar ?? user.image } : null}
            uploadFile={upload}
            presence={presenceQuery.data ?? OFFLINE}
            embedOpenMode="navigate"
            helpSearch={helpSearch}
            onConversationStarted={onConversationStarted}
          />
        </div>
      )}
    </div>
  )
}
