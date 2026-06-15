import { createFileRoute } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { WidgetVoteButton } from '@/components/widget/widget-vote-button'
import type { PostId } from '@quackback/ids'
import { WidgetShell } from '@/components/widget/widget-shell'
import {
  type WidgetTab,
  type WidgetView,
  type EnabledTabs,
  resolveInitialTab,
  resolveInitialView,
  supportRootView,
  supportEnabled,
  homeEnabled,
} from '@/components/widget/widget-nav'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetOverview } from '@/components/widget/widget-overview'
import { WidgetPostDetail } from '@/components/widget/widget-post-detail'
import { WidgetChangelog } from '@/components/widget/widget-changelog'
import { WidgetChangelogDetail } from '@/components/widget/widget-changelog-detail'
import { WidgetHelp } from '@/components/widget/widget-help'
import { WidgetHelpCategory } from '@/components/widget/widget-help-category'
import { WidgetHelpDetail } from '@/components/widget/widget-help-detail'
import { WidgetLiveChat } from '@/components/widget/widget-live-chat'
import type { ConversationId } from '@quackback/ids'
import { WidgetMessagesSection } from '@/components/widget/widget-messages-section'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { WidgetSupportCard } from '@/components/widget/widget-support-card'
import { WidgetSupportList } from '@/components/widget/widget-support-list'
import { WidgetSupportNew } from '@/components/widget/widget-support-new'
import { WidgetSupportDetail } from '@/components/widget/widget-support-detail'
import { portalQueries } from '@/lib/client/queries/portal'
import { fetchBoardCapabilitiesFn } from '@/lib/server/functions/portal'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { widgetQueryKeys, INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import { CHAT_PRESENCE_QUERY_KEY } from '@/components/widget/use-chat-presence'
import { resolveWidgetContextFn } from '@/lib/server/functions/widget-context'

const searchSchema = z.object({
  board: z.string().optional(),
  // `?c=<conversationId>` opens the widget straight to live chat — used by the
  // deep link in agent-reply emails. Navigation only; carries no capability.
  c: z.string().optional(),
  applicationKey: z.string().optional(),
  environment: z.string().optional(),
  hostOrigin: z.string().optional(),
  app: z.string().optional(),
  env: z.string().optional(),
})

export const Route = createFileRoute('/widget/')({
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    const { queryClient, settings, session } = context
    const search = location.search as z.infer<typeof searchSchema>
    const widgetContext = await resolveWidgetContextFn({
      data: {
        applicationKey: search.applicationKey ?? search.app,
        environment: search.environment ?? search.env,
        hostOrigin: search.hostOrigin,
      },
    })
    const widgetConfig = widgetContext.publicConfig
    const feedbackFilters = widgetContext.contentFilters.feedback
    const allowedBoardIds = new Set(feedbackFilters?.boardIds ?? [])
    const allowedBoardSlugs = new Set(feedbackFilters?.boardSlugs ?? [])
    const allowedStatusIds = new Set(feedbackFilters?.statusIds ?? [])
    const hasBoardFilter = allowedBoardIds.size > 0 || allowedBoardSlugs.size > 0
    const hasStatusFilter = allowedStatusIds.size > 0
    const changelogFilter = widgetContext.contentFilters.changelog
    const changelogHasVisibleEntries =
      changelogFilter?.mode !== 'selected_entries' || (changelogFilter.entryIds?.length ?? 0) > 0

    const { getBaseUrl } = await import('@/lib/server/config')

    if (!widgetConfig.enabled) {
      return {
        widgetEnabled: false,
        posts: [],
        postsHasMore: false,
        statuses: [],
        boards: [],
        orgSlug: settings?.slug ?? '',
        boardPermissions: {},
        tabs: {
          feedback: false,
          changelog: false,
          help: false,
          chat: false,
          home: false,
        },
        linkPreviews: false,
        defaultBoard: undefined,
        imageUploadsInWidget: false,
        ticketingEnabled: false,
        supportCategories: [],
        chatConfigured: false,
        portalAccess: {
          isPrivate: settings?.publicPortalConfig?.portalAccess?.isPrivate ?? false,
          widgetSignIn: settings?.publicPortalConfig?.portalAccess?.widgetSignIn ?? false,
        },
        portalOrigin: getBaseUrl(),
      }
    }

    const portalData = await queryClient.ensureQueryData(
      portalQueries.portalData({
        boardSlug: search.board,
        sort: 'top',
        userId: session?.user?.id,
      })
    )

    queryClient.setQueryData(
      widgetQueryKeys.votedPosts.bySession(INITIAL_SESSION_VERSION),
      new Set(portalData.votedPostIds)
    )

    const boards = portalData.boards
      .filter((board) => {
        if (!hasBoardFilter) return true
        return allowedBoardIds.has(board.id) || allowedBoardSlugs.has(board.slug)
      })
      .map((b) => ({
        id: b.id as string,
        name: b.name,
        slug: b.slug,
      }))
    const allowedBoardIdSet = new Set(boards.map((board) => board.id))
    const feedbackHasVisibleBoard = !hasBoardFilter || boards.length > 0
    const feedbackTabEnabled = (widgetConfig.tabs?.feedback ?? true) && feedbackHasVisibleBoard
    const defaultBoard =
      widgetConfig.defaultBoard && boards.some((board) => board.slug === widgetConfig.defaultBoard)
        ? widgetConfig.defaultBoard
        : hasBoardFilter
          ? boards[0]?.slug
          : widgetConfig.defaultBoard

    // Same gate as the `chat` tab below: widget enabled + Support Inbox flag +
    // live chat enabled + tab on. Hoisted so we only compute presence when chat shows.
    const chatConfigured =
      (widgetConfig.enabled ?? false) &&
      ((settings?.featureFlags as { supportInbox?: boolean } | undefined)?.supportInbox ?? false) &&
      (widgetConfig.chat?.enabled ?? false) &&
      (widgetConfig.tabs?.chat ?? false)
    const { getSupportSurfaceAccessFn } = await import('@/lib/server/functions/chat')
    const supportAccess = chatConfigured
      ? await getSupportSurfaceAccessFn({ data: { surface: 'widget' } })
      : { granted: false }
    const chatTabEnabled = chatConfigured && supportAccess.granted

    // Presence is tenant-global (not visitor-specific), so the anonymous SSR
    // baseline value is exactly correct for every visitor — seed the shared
    // presence query so the chat online/offline strip paints right immediately
    // instead of flashing "away" until the first client poll. The seed is
    // dehydrated to the client just like the votedPosts seed below. Skipped when
    // chat isn't shown.
    if (chatTabEnabled) {
      try {
        // Call the server fn (not an unwrapped helper): its handler — and the
        // ioredis-reaching presence import inside it — is stripped from the
        // client bundle. Server-side it runs inline and returns the verdict.
        const { getChatPresenceFn } = await import('@/lib/server/functions/chat')
        queryClient.setQueryData(CHAT_PRESENCE_QUERY_KEY, await getChatPresenceFn())
      } catch {
        // A presence read failure must never break the whole widget load — leave
        // the seed empty and let the client query fetch presence on mount.
      }
    }

    return {
      widgetEnabled: true,
      posts: portalData.posts.items
        .map((p) => ({
          id: p.id,
          title: p.title,
          voteCount: p.voteCount,
          statusId: p.statusId,
          commentCount: p.commentCount,
          board: p.board,
        }))
        .filter((post) => {
          if (hasBoardFilter && (!post.board || !allowedBoardIdSet.has(post.board.id))) return false
          if (hasStatusFilter && (!post.statusId || !allowedStatusIds.has(post.statusId))) {
            return false
          }
          return true
        }),
      postsHasMore: portalData.posts.hasMore,
      statuses: portalData.statuses
        .filter((s) => !hasStatusFilter || allowedStatusIds.has(s.id))
        .map((s) => ({
          id: s.id as string,
          name: s.name,
          color: s.color,
        })),
      // fetchPortalData already filtered boards through boardViewFilter
      // against the request actor (including widget-supplied segments via
      // the signed identity token). Re-filtering by audience.kind here
      // would silently drop authenticated/segment boards that the actor
      // is legitimately allowed to see.
      boards,
      orgSlug: settings?.slug ?? '',
      // Per-board submit/vote capability for the request actor, server-computed
      // (boardCapabilitiesForActor composes each board's access tier with the
      // workspace anonymous switch). The widget gates its submit/vote CTAs per
      // board off this map instead of a workspace-wide flag, so it never
      // advertises an action the board's tier rejects (#191). Keyed by board id.
      boardPermissions: portalData.boardPermissions,
      tabs: {
        feedback: feedbackTabEnabled,
        changelog: (widgetConfig.tabs?.changelog ?? false) && changelogHasVisibleEntries,
        help:
          ((settings?.featureFlags as { helpCenter?: boolean } | undefined)?.helpCenter ?? false) &&
          (settings?.helpCenterConfig?.enabled ?? false) &&
          (widgetConfig.tabs?.help ?? false),
        // Support Inbox flag + live chat enabled + tab on (computed above).
        chat: chatTabEnabled,
        // Admin opt-out for the aggregated Home tab (defaults to shown).
        home: widgetConfig.tabs?.home ?? true,
      },
      linkPreviews:
        (settings?.featureFlags as { linkPreviews?: boolean } | undefined)?.linkPreviews ?? false,
      defaultBoard,
      imageUploadsInWidget: widgetConfig.imageUploadsInWidget ?? true,
      ticketingEnabled: widgetConfig.ticketing?.enabled ?? false,
      supportCategories: (widgetContext.supportConfig.categories ?? [])
        .filter((category) => category.visible !== false)
        .map((category) => ({
          categoryKey: category.categoryKey,
          label: category.label,
          description: category.description,
          icon: category.icon,
          defaultPriority: category.defaultPriority,
          allowedPriorities: category.allowedPriorities,
          display: category.display,
        })),
      chatConfigured,
      portalAccess: {
        isPrivate: settings?.publicPortalConfig?.portalAccess?.isPrivate ?? false,
        widgetSignIn: settings?.publicPortalConfig?.portalAccess?.widgetSignIn ?? false,
      },
      // The portal's own origin (BASE_URL env), resolved server-side so the
      // widget handoff URL always points at the portal host — not at the widget
      // iframe origin, which may differ in self-hosted deployments.
      portalOrigin: getBaseUrl(),
    }
  },
  component: WidgetPage,
})

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
}

interface WidgetListPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  commentCount: number
  board: { id: string; name: string; slug: string }
}

type SupportReturnView = Extract<WidgetView, 'overview' | 'help' | 'messages' | 'feedback'>

function resolveSupportReturnView(tabs: EnabledTabs): SupportReturnView {
  if (homeEnabled(tabs)) return 'overview'
  if (supportEnabled(tabs)) return supportRootView(tabs)
  return 'feedback'
}

function activeTabForSupportReturnView(view: SupportReturnView): WidgetTab {
  if (view === 'overview') return 'home'
  if (view === 'help' || view === 'messages') return 'help'
  return 'feedback'
}

type WidgetLoaderData = ReturnType<typeof Route.useLoaderData>

function WidgetPage() {
  const data = Route.useLoaderData()
  if (!data.widgetEnabled) return null
  return <EnabledWidgetPage data={data} />
}

function EnabledWidgetPage({ data }: { data: WidgetLoaderData }) {
  const {
    postsHasMore,
    statuses,
    boards,
    orgSlug,
    boardPermissions,
    tabs: loaderTabs,
    linkPreviews,
    defaultBoard,
    imageUploadsInWidget,
    ticketingEnabled,
    supportCategories,
    chatConfigured,
    portalAccess,
    portalOrigin,
  } = data
  const posts = data.posts as WidgetListPost[]

  const { ensureSession, sessionVersion } = useWidgetAuth()
  const { data: chatAccess } = useQuery({
    queryKey: ['widget', 'supportAccess', sessionVersion],
    queryFn: async () => {
      const { getSupportSurfaceAccessFn } = await import('@/lib/server/functions/chat')
      return getSupportSurfaceAccessFn({
        data: { surface: 'widget' },
        headers: getWidgetAuthHeaders(),
      })
    },
    enabled: chatConfigured,
    initialData:
      sessionVersion === INITIAL_SESSION_VERSION ? { granted: loaderTabs.chat } : undefined,
    staleTime: 30 * 1000,
  })
  const tabs = useMemo(
    () => ({ ...loaderTabs, chat: chatConfigured && (chatAccess?.granted ?? false) }),
    [loaderTabs, chatConfigured, chatAccess?.granted]
  )

  // The loader seeds boardPermissions for the anonymous SSR baseline (no Bearer
  // at loader time). Refetch it for the REAL actor with the widget's Bearer
  // token, re-keyed on sessionVersion so it updates after identify — then the
  // feed gates votes/submission per the actual actor instead of OR-ing in a
  // blanket isIdentified (which advertised CTAs on segments/team boards the
  // actor cannot act on). Seeded with the loader map so SSR + first paint match.
  const { data: livePermissions } = useQuery({
    queryKey: ['widget', 'boardPermissions', sessionVersion],
    queryFn: () => fetchBoardCapabilitiesFn({ headers: getWidgetAuthHeaders() }),
    // Seed ONLY the initial (anonymous, SSR) key from the loader. initialData
    // stamps an entry fresh as of now, so seeding it on every key would also
    // mark the post-identify key fresh and suppress the Bearer refetch within
    // staleTime — leaving an identified viewer stuck on the anonymous baseline.
    // After identify the key changes, carries no initialData, and refetches with
    // the Bearer while keepPreviousData shows the prior map meanwhile.
    initialData: sessionVersion === INITIAL_SESSION_VERSION ? boardPermissions : undefined,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  })

  const { c: resumeConversationId } = Route.useSearch()
  const initialTab = resolveInitialTab(tabs)
  // A `?c=` deep link opens straight to chat (when chat is enabled); the widget
  // then loads the visitor's active conversation from their session.
  const [view, setView] = useState<WidgetView>(
    resumeConversationId && tabs.chat ? 'chat' : resolveInitialView(tabs)
  )
  const [activeTab, setActiveTab] = useState<WidgetTab>(
    resumeConversationId && tabs.chat ? 'help' : initialTab
  )
  // Which thread the chat view opens: an id, 'new', or null (active/default).
  // Seeded from the ?c= deep link so it opens that exact thread.
  const [chatTarget, setChatTarget] = useState<ConversationId | 'new' | null>(
    resumeConversationId ? (resumeConversationId as ConversationId) : null
  )

  useEffect(() => {
    if (view !== 'chat' || tabs.chat) return
    const nextTab = resolveInitialTab(tabs)
    setActiveTab(nextTab)
    setView(resolveInitialView(tabs))
    setChatTarget(null)
  }, [view, tabs])

  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [selectedChangelogId, setSelectedChangelogId] = useState<string | null>(null)
  const [selectedHelpSlug, setSelectedHelpSlug] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<{
    id: string
    name: string
    icon: string | null
  } | null>(null)
  const [createdPosts, setCreatedPosts] = useState<WidgetListPost[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [supportReturnView, setSupportReturnView] = useState<SupportReturnView>(() =>
    resolveSupportReturnView(tabs)
  )

  const allPosts = useMemo(() => {
    const createdIds = new Set(createdPosts.map((p) => p.id))
    return [...createdPosts, ...posts.filter((p) => !createdIds.has(p.id))]
  }, [posts, createdPosts])

  const openChat = useCallback((target?: ConversationId | 'new') => {
    setChatTarget(target ?? null)
    setActiveTab('help')
    setView('chat')
  }, [])

  const openSupport = useCallback(
    (returnView?: SupportReturnView, ticketId?: string) => {
      if (!ticketingEnabled) return
      const nextReturnView = returnView ?? resolveSupportReturnView(tabs)
      setSupportReturnView(nextReturnView)
      setActiveTab(activeTabForSupportReturnView(nextReturnView))
      setSelectedTicketId(ticketId ?? null)
      setView(ticketId ? 'support-detail' : 'support-list')
    },
    [tabs, ticketingEnabled]
  )

  // Listen for quackback:open messages from the SDK
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const msg = event.data
      if (!msg || typeof msg !== 'object' || msg.type !== 'quackback:open' || !msg.data) return

      const opts = msg.data as { view?: string; ticketId?: string }
      if (opts.view === 'support' && ticketingEnabled) {
        openSupport(undefined, opts.ticketId)
      } else if (opts.view === 'changelog' && tabs.changelog) {
        setActiveTab('changelog')
        setView('changelog')
      } else if (opts.view === 'help' && (tabs.help || tabs.chat)) {
        setActiveTab('help')
        setView(supportRootView(tabs))
      } else if ((opts.view === 'chat' || opts.view === 'live-chat') && tabs.chat) {
        openChat()
      } else if ((opts.view === 'home' || opts.view === 'overview') && homeEnabled(tabs)) {
        setActiveTab('home')
        setView('overview')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tabs, openChat, openSupport, ticketingEnabled])

  const handlePostCreated = useCallback((post: SuccessPost) => {
    setCreatedPosts((prev: WidgetListPost[]) => [
      {
        id: post.id,
        title: post.title,
        voteCount: post.voteCount,
        statusId: post.statusId,
        commentCount: 0,
        board: post.board,
      },
      ...prev,
    ])
    setSuccessPost(post)
    setView('success')
  }, [])

  const handlePostSelect = useCallback((postId: string) => {
    setSelectedPostId(postId)
    setView('post-detail')
  }, [])

  const handleBack = useCallback(() => {
    if (view === 'changelog-detail') {
      setSelectedChangelogId(null)
      setView('changelog')
      return
    }
    if (view === 'help-detail') {
      setSelectedHelpSlug(null)
      if (selectedCategory) {
        setView('help-category')
      } else {
        setView('help')
      }
      return
    }
    if (view === 'help-category') {
      setSelectedCategory(null)
      setView('help')
      return
    }
    if (view === 'support-detail') {
      setSelectedTicketId(null)
      setView('support-list')
      return
    }
    if (view === 'support-new') {
      setSelectedTicketId(null)
      setView('support-list')
      return
    }
    if (view === 'support-list') {
      setSelectedTicketId(null)
      setActiveTab(activeTabForSupportReturnView(supportReturnView))
      setView(supportReturnView)
      return
    }
    if (view === 'chat') {
      // Chat is opened from the support surface; back returns to its root
      // (help articles, or the messages list for a chat-only widget).
      setView(supportRootView(tabs))
      return
    }
    setSelectedPostId(null)
    setView('feedback')
  }, [view, selectedCategory, tabs, supportReturnView])

  const handleTabChange = useCallback(
    (tab: WidgetTab) => {
      setActiveTab(tab)
      if (tab === 'home') {
        setView('overview')
      } else if (tab === 'feedback') {
        setSelectedPostId(null)
        setView('feedback')
      } else if (tab === 'changelog') {
        setSelectedChangelogId(null)
        setView('changelog')
      } else {
        // 'help' — the combined support surface (articles + messages)
        setSelectedHelpSlug(null)
        setSelectedCategory(null)
        setView(supportRootView(tabs))
      }
    },
    [tabs]
  )

  const handleChangelogEntrySelect = useCallback((entryId: string) => {
    setSelectedChangelogId(entryId)
    setView('changelog-detail')
  }, [])

  const handleHelpArticleSelect = useCallback((articleSlug: string) => {
    setSelectedHelpSlug(articleSlug)
    setView('help-detail')
  }, [])

  const handleHelpCategorySelect = useCallback(
    (categoryId: string, categoryName: string, categoryIcon: string | null) => {
      setSelectedCategory({ id: categoryId, name: categoryName, icon: categoryIcon })
      setView('help-category')
    },
    []
  )

  const handleHelpCategoryArticleSelect = useCallback((articleSlug: string) => {
    setSelectedHelpSlug(articleSlug)
    setView('help-detail')
  }, [])

  const handleSupportNewTicket = useCallback(() => {
    setView('support-new')
  }, [])

  const handleSupportTicketSelect = useCallback((ticketId: string) => {
    setSelectedTicketId(ticketId)
    setView('support-detail')
  }, [])

  const handleSupportTicketCreated = useCallback((ticket: { id: string }) => {
    setSelectedTicketId(ticket.id)
    setView('support-detail')
  }, [])

  const showFeedbackSupportCard = ticketingEnabled && !homeEnabled(tabs) && !supportEnabled(tabs)

  // Root views have no back arrow. 'messages' is the chat-only support root.
  // Ticketing views keep a back arrow and return through their recorded origin.
  const shellOnBack =
    view !== 'overview' &&
    view !== 'feedback' &&
    view !== 'changelog' &&
    view !== 'help' &&
    view !== 'messages'
      ? handleBack
      : undefined

  return (
    <WidgetShell
      orgSlug={orgSlug}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      onBack={shellOnBack}
      enabledTabs={tabs}
      portalAccess={portalAccess}
      portalOrigin={portalOrigin}
    >
      {view === 'overview' && (
        <WidgetOverview
          tabs={tabs}
          onLeaveFeedback={() => handleTabChange('feedback')}
          onGetHelp={() => handleTabChange('help')}
          onOpenSupport={ticketingEnabled ? () => openSupport('overview') : undefined}
          onResumeChat={() => openChat()}
          onSeeChangelog={() => handleTabChange('changelog')}
          onOpenChangelogEntry={(id) => {
            setActiveTab('changelog')
            handleChangelogEntrySelect(id)
          }}
        />
      )}

      {view === 'changelog' && <WidgetChangelog onEntrySelect={handleChangelogEntrySelect} />}

      {view === 'chat' && (
        <WidgetLiveChat
          key={chatTarget ?? 'active'}
          helpEnabled={tabs.help}
          onArticleSelect={handleHelpArticleSelect}
          conversationTarget={chatTarget === null ? undefined : chatTarget}
          linkPreviews={linkPreviews}
        />
      )}

      {view === 'messages' && (
        <div className="flex h-full flex-col overflow-y-auto px-3 pb-3">
          {ticketingEnabled && (
            <div className="w-full pt-2">
              <WidgetSupportCard
                onOpen={() => openSupport('messages')}
                categories={supportCategories}
              />
            </div>
          )}
          <WidgetMessagesSection onOpenChat={openChat} />
        </div>
      )}

      {view === 'changelog-detail' && selectedChangelogId && (
        <WidgetChangelogDetail entryId={selectedChangelogId} />
      )}

      {view === 'help' && (
        <WidgetHelp
          onArticleSelect={handleHelpArticleSelect}
          onCategorySelect={handleHelpCategorySelect}
          onOpenChat={tabs.chat ? () => openChat() : undefined}
          onOpenSupport={ticketingEnabled ? () => openSupport(supportRootView(tabs)) : undefined}
          supportCategories={supportCategories}
        />
      )}

      {view === 'help-category' && selectedCategory && (
        <WidgetHelpCategory
          categoryId={selectedCategory.id}
          categoryName={selectedCategory.name}
          categoryIcon={selectedCategory.icon}
          onArticleSelect={handleHelpCategoryArticleSelect}
        />
      )}

      {view === 'help-detail' && selectedHelpSlug && (
        <WidgetHelpDetail articleSlug={selectedHelpSlug} />
      )}

      {/* Keep home mounted (hidden) when viewing post detail so form state is preserved */}
      <div
        className={
          view === 'feedback' || view === 'post-detail'
            ? view === 'feedback'
              ? 'flex flex-col h-full'
              : 'hidden'
            : 'hidden'
        }
      >
        <WidgetHome
          initialPosts={allPosts}
          initialHasMore={postsHasMore}
          statuses={statuses}
          boards={boards}
          boardPermissions={livePermissions}
          defaultBoard={defaultBoard}
          onPostSelect={handlePostSelect}
          onPostCreated={handlePostCreated}
          imageUploadsInWidget={imageUploadsInWidget}
          supportSlot={
            showFeedbackSupportCard ? (
              <WidgetSupportCard
                onOpen={() => openSupport('feedback')}
                categories={supportCategories}
              />
            ) : undefined
          }
        />
      </div>

      {view === 'support-list' && (
        <WidgetSupportList
          onNewTicket={handleSupportNewTicket}
          onTicketSelect={handleSupportTicketSelect}
          categories={supportCategories}
        />
      )}

      {view === 'support-new' && (
        <WidgetSupportNew onCreated={handleSupportTicketCreated} categories={supportCategories} />
      )}

      {view === 'support-detail' && selectedTicketId && (
        <WidgetSupportDetail ticketId={selectedTicketId} />
      )}

      {view === 'post-detail' && selectedPostId && (
        <WidgetPostDetail postId={selectedPostId} statuses={statuses} />
      )}

      {view === 'success' &&
        successPost &&
        (() => {
          const successStatus = successPost.statusId
            ? (statuses.find(
                (s: { id: string; name: string; color: string }) => s.id === successPost.statusId
              ) ?? null)
            : null
          // Vote gate follows the created post's board for the real actor
          // (livePermissions is refetched with the widget's Bearer identity).
          const canVote = livePermissions?.[successPost.board.id]?.canVote ?? false

          return (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 shrink-0">
                  <CheckCircleIcon className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Thanks for your feedback!</p>
                  <p className="text-[11px] text-muted-foreground">Your idea has been submitted.</p>
                </div>
              </div>

              <div className="px-3">
                <div
                  className="flex items-center gap-2 rounded-lg bg-muted/20 border border-border/50 px-2 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    setSelectedPostId(successPost.id)
                    setView('post-detail')
                  }}
                >
                  <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                    <WidgetVoteButton
                      postId={successPost.id as PostId}
                      voteCount={successPost.voteCount}
                      onBeforeVote={canVote ? ensureSession : undefined}
                      noAccessReason={
                        canVote ? undefined : "You don't have access to vote on this board"
                      }
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground line-clamp-2">
                      {successPost.title}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {successStatus && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <span
                            className="size-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: successStatus.color }}
                          />
                          {successStatus.name}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60">
                        {successPost.board.name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-3 pt-3">
                <button
                  type="button"
                  onClick={handleBack}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground bg-muted/30 hover:bg-muted/50 rounded-lg border border-border/50 transition-colors"
                >
                  <ArrowLeftIcon className="w-3.5 h-3.5" />
                  Back to ideas
                </button>
              </div>
            </div>
          )
        })()}
    </WidgetShell>
  )
}
