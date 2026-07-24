import { createFileRoute } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'
import { lazy, Suspense, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FormattedMessage } from 'react-intl'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { WidgetVoteButton } from '@/components/widget/widget-vote-button'
import type { PostId } from '@quackback/ids'
import { WidgetShell } from '@/components/widget/widget-shell'
import {
  type WidgetTab,
  type WidgetView,
  resolveInitialTab,
  resolveInitialView,
  homeEnabled,
  contentSurfaceCount,
  isExpandedView,
} from '@/components/widget/widget-nav'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetOverview } from '@/components/widget/widget-overview'
import { WidgetHeroBackdrop } from '@/components/widget/widget-hero-backdrop'
import type { ConversationId } from '@quackback/ids'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { portalQueries } from '@/lib/client/queries/portal'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { fetchBoardCapabilitiesFn } from '@/lib/server/functions/portal'
import { listPublicArticlesFn } from '@/lib/server/functions/help-center'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { sendToHost } from '@/lib/client/widget-bridge'
import { widgetQueryKeys, INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import {
  CONVERSATION_PRESENCE_QUERY_KEY,
  useConversationPresence,
} from '@/components/widget/use-messenger-presence'
import { conversationAvailable } from '@/lib/shared/conversation/presence'
import { ConversationPresenceBadge } from '@/components/shared/conversation/conversation-presence-badge'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/shared/spinner'
import { conversationSummaryKey } from '@/components/widget/use-messenger-summary'

// Secondary views load behind lazy() boundaries so the iframe's first paint
// only needs the shell + Home/feedback — the detail views carry the
// rich-text editor (tiptap) and the messenger carries the conversation thread.
// The shared import thunks below also feed an idle-time prefetch after mount,
// so by the time a visitor clicks a tab the chunk is already cached.
const loadPostDetail = () => import('@/components/widget/widget-post-detail')
const loadChangelog = () => import('@/components/widget/widget-changelog')
const loadChangelogDetail = () => import('@/components/widget/widget-changelog-detail')
const loadHelp = () => import('@/components/widget/widget-help')
const loadHelpCategory = () => import('@/components/widget/widget-help-category')
const loadHelpDetail = () => import('@/components/widget/widget-help-detail')
const loadMessenger = () => import('@/components/widget/widget-messenger')
const loadMessagesView = () => import('@/components/widget/widget-messages')

const WidgetPostDetail = lazy(() => loadPostDetail().then((m) => ({ default: m.WidgetPostDetail })))
const WidgetChangelog = lazy(() => loadChangelog().then((m) => ({ default: m.WidgetChangelog })))
const WidgetChangelogDetail = lazy(() =>
  loadChangelogDetail().then((m) => ({ default: m.WidgetChangelogDetail }))
)
const WidgetHelp = lazy(() => loadHelp().then((m) => ({ default: m.WidgetHelp })))
const WidgetHelpCategory = lazy(() =>
  loadHelpCategory().then((m) => ({ default: m.WidgetHelpCategory }))
)
const WidgetHelpDetail = lazy(() => loadHelpDetail().then((m) => ({ default: m.WidgetHelpDetail })))
const WidgetMessenger = lazy(() => loadMessenger().then((m) => ({ default: m.WidgetMessenger })))
const WidgetMessages = lazy(() => loadMessagesView().then((m) => ({ default: m.WidgetMessages })))

const LAZY_VIEW_LOADERS = [
  loadPostDetail,
  loadChangelog,
  loadChangelogDetail,
  loadHelp,
  loadHelpCategory,
  loadHelpDetail,
  loadMessenger,
  loadMessagesView,
]

const searchSchema = z.object({
  board: z.string().optional(),
  // `?c=<conversationId>` opens the widget straight to Messenger — used by the
  // deep link in agent-reply emails. Navigation only; carries no capability.
  c: z.string().optional(),
})

export const Route = createFileRoute('/widget/')({
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    const { queryClient, settings, session } = context
    const search = location.search as z.infer<typeof searchSchema>
    const feedbackProductEnabled = settings?.featureFlags?.feedback ?? true
    const changelogProductEnabled = settings?.featureFlags?.changelog ?? true

    // Same triple-gate as the `messages` tab below: Support Inbox flag +
    // Messenger enabled + tab on. Hoisted so we only compute presence when
    // Messenger shows.
    const messengerTabEnabled =
      ((settings?.featureFlags as { supportInbox?: boolean } | undefined)?.supportInbox ?? false) &&
      (settings?.publicWidgetConfig?.messenger?.enabled ?? false) &&
      (settings?.publicWidgetConfig?.tabs?.messenger ?? false)

    // Converged Messages surface: a tickets-enabled workspace surfaces its
    // ticket pairs through the Messages tab even with the messenger off
    // (email-first workspaces) — the chat-start affordance stays gated on the
    // messenger via `messengerEnabled` below.
    const ticketsEnabled =
      (settings?.featureFlags as { supportTickets?: boolean } | undefined)?.supportTickets ?? false

    const helpTabEnabled =
      ((settings?.featureFlags as { helpCenter?: boolean } | undefined)?.helpCenter ?? false) &&
      (settings?.helpCenterConfig?.enabled ?? false) &&
      (settings?.publicWidgetConfig?.tabs?.help ?? false)
    const changelogTabEnabled =
      changelogProductEnabled && (settings?.publicWidgetConfig?.tabs?.changelog ?? false)

    // Every branch below is independent, so the whole SSR seed runs as ONE
    // parallel batch — document TTFB is the slowest branch, not the sum.
    //
    // SSR-complete Home: seed everything its sections read so the first paint
    // never pops content in after render. All of these are public/tenant-global
    // except the conversation summary, which is correct for cookie-authed
    // visitors here; Bearer-token visitors refetch it client-side on mount.
    const emptyPortalData = {
      boards: [],
      posts: { items: [], hasMore: false },
      statuses: [],
      votedPostIds: [],
      boardPermissions: {} as Record<string, { canSubmit: boolean; canVote: boolean }>,
    }
    let topArticles: { slug: string; title: string }[] = []
    // Teammate-avatar cluster for the Home header. Tenant-global and public-safe
    // (name + image only), so the anonymous SSR baseline is correct for everyone.
    let team: { name: string; avatarUrl: string | null }[] = []
    const [portalData, { getBaseUrl }] = await Promise.all([
      feedbackProductEnabled
        ? queryClient.ensureQueryData(
            portalQueries.portalData({
              boardSlug: search.board,
              sort: 'top',
              userId: session?.user?.id,
            })
          )
        : Promise.resolve(emptyPortalData),
      import('@/lib/server/config'),
      // Presence is tenant-global (not visitor-specific), so the anonymous SSR
      // baseline value is exactly correct for every visitor — seed the shared
      // presence query so the Messenger online/offline strip paints right
      // immediately instead of flashing "away" until the first client poll.
      // The seed is dehydrated to the client just like the votedPosts seed
      // below. Skipped when Messenger isn't shown. A presence read failure must
      // never break the whole widget load — leave the seed empty and let the
      // client query fetch presence on mount. Call the server fn (not an
      // unwrapped helper): its handler — and the ioredis-reaching presence
      // import inside it — is stripped from the client bundle.
      messengerTabEnabled
        ? import('@/lib/server/functions/conversation')
            .then(({ getConversationPresenceFn }) => getConversationPresenceFn())
            .then((presence) => {
              queryClient.setQueryData(CONVERSATION_PRESENCE_QUERY_KEY, presence)
            })
            .catch(() => {})
        : Promise.resolve(),
      // Never break the widget load over the decorative header avatar cluster.
      (settings?.publicWidgetConfig?.home?.showTeamAvatars ?? true)
        ? import('@/lib/server/functions/conversation')
            .then(({ getWidgetTeamAvatarsFn }) => getWidgetTeamAvatarsFn())
            .then((avatars) => {
              team = avatars
            })
            .catch(() => {})
        : Promise.resolve(),
      changelogTabEnabled
        ? queryClient.ensureInfiniteQueryData(publicChangelogQueries.list()).catch(() => {})
        : Promise.resolve(),
      helpTabEnabled
        ? queryClient.ensureQueryData(publicHelpCenterQueries.categories()).catch(() => {})
        : Promise.resolve(),
      helpTabEnabled
        ? listPublicArticlesFn({ data: { limit: 4 } })
            .then((res) => {
              topArticles = res.items.map((a) => ({ slug: a.slug, title: a.title }))
            })
            .catch(() => {})
        : Promise.resolve(),
      messengerTabEnabled
        ? import('@/lib/server/functions/conversation')
            .then(({ getMyConversationFn }) => getMyConversationFn())
            .then((res) => {
              queryClient.setQueryData(conversationSummaryKey(INITIAL_SESSION_VERSION), {
                conversation: res.conversation ?? null,
                teamName: res.teamName,
              })
            })
            .catch(() => {})
        : Promise.resolve(),
    ])

    queryClient.setQueryData(
      widgetQueryKeys.votedPosts.bySession(INITIAL_SESSION_VERSION),
      new Set(portalData.votedPostIds)
    )

    return {
      posts: portalData.posts.items.map((p) => ({
        id: p.id,
        title: p.title,
        voteCount: p.voteCount,
        statusId: p.statusId,
        commentCount: p.commentCount,
        board: p.board,
      })),
      postsHasMore: portalData.posts.hasMore,
      statuses: portalData.statuses.map((s) => ({
        id: s.id as string,
        name: s.name,
        color: s.color,
      })),
      // fetchPortalData already filtered boards through boardViewFilter
      // against the request actor (including widget-supplied segments via
      // the signed identity token). Re-filtering by audience.kind here
      // would silently drop authenticated/segment boards that the actor
      // is legitimately allowed to see.
      boards: portalData.boards.map((b) => ({
        id: b.id as string,
        name: b.name,
        slug: b.slug,
      })),
      orgSlug: settings?.slug ?? '',
      // Per-board submit/vote capability for the request actor, server-computed
      // (boardCapabilitiesForActor composes each board's access tier with the
      // workspace anonymous switch). The widget gates its submit/vote CTAs per
      // board off this map instead of a workspace-wide flag, so it never
      // advertises an action the board's tier rejects (#191). Keyed by board id.
      boardPermissions: portalData.boardPermissions,
      tabs: {
        feedback: feedbackProductEnabled && (settings?.publicWidgetConfig?.tabs?.feedback ?? true),
        changelog: changelogTabEnabled,
        help:
          ((settings?.featureFlags as { helpCenter?: boolean } | undefined)?.helpCenter ?? false) &&
          (settings?.helpCenterConfig?.enabled ?? false) &&
          (settings?.publicWidgetConfig?.tabs?.help ?? false),
        // Support Inbox flag + Messenger enabled + tab on (computed above), OR
        // tickets on (the converged surface lists ticket pairs here). The
        // persisted config names the messenger surface `messenger`; the widget
        // speaks `messages`.
        messages: messengerTabEnabled || ticketsEnabled,
        // Admin opt-out for the aggregated Home tab (defaults to shown).
        home: settings?.publicWidgetConfig?.tabs?.home ?? true,
      },
      // Home surface customisation (greeting, hero style, quick-link cards).
      home: settings?.publicWidgetConfig?.home ?? null,
      // Per-locale copy overrides; the Home surface resolves greeting/subtitle
      // against the visitor's locale client-side.
      translations: settings?.publicWidgetConfig?.translations ?? null,
      // Workspace logo for the Home header (branding config).
      logoUrl: settings?.brandingData?.logoUrl ?? null,
      // Top help articles for the Home search card (public; SSR'd).
      topArticles,
      // Team label for widget surfaces (changelog header, messages fallback):
      // the configured messenger team name, else the workspace name.
      teamName: settings?.publicWidgetConfig?.messenger?.teamName || settings?.name || null,
      // Teammate avatars for the Home header cluster (empty when disabled).
      team,
      // AI-assistant display identity — fronts unassigned conversations in the
      // Messages list and the Home messages card. Null when disabled.
      assistant:
        messengerTabEnabled && settings?.publicWidgetConfig?.messenger?.assistant?.enabled
          ? {
              name: settings.publicWidgetConfig.messenger.assistant.name?.trim() || 'Quinn',
              avatarUrl: settings.publicWidgetConfig.messenger.assistant.avatarUrl || null,
            }
          : null,
      linkPreviews:
        (settings?.featureFlags as { supportInbox?: boolean } | undefined)?.supportInbox ?? false,
      defaultBoard: settings?.publicWidgetConfig?.defaultBoard,
      portalAccess: {
        isPrivate: settings?.publicPortalConfig?.portalAccess?.isPrivate ?? false,
        widgetSignIn: settings?.publicPortalConfig?.portalAccess?.widgetSignIn ?? false,
      },
      // Whether the visitor can START a conversation (the messenger proper).
      // False for tickets-only workspaces: Messages lists their threads, but
      // the chat-start affordances hide (agents/email initiate).
      messengerEnabled: messengerTabEnabled,
      // The portal's own origin (BASE_URL env), resolved server-side so the
      // widget handoff URL always points at the portal host — not at the widget
      // iframe origin, which may differ in self-hosted deployments.
      portalOrigin: getBaseUrl(),
    }
  },
  component: WidgetRoute,
})

function WidgetRoute() {
  const { tabs } = Route.useLoaderData()
  if (contentSurfaceCount(tabs) === 0) return null
  return <WidgetPage />
}

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
}

/**
 * Entry transition for a widget view. Root views (tab switches) rise and fade
 * in place; pushed views (details, the messenger thread) slide in from the
 * side like a navigation push. Entry-only by design: exits are instant, so the
 * keep-mounted feedback view and back-navigation stay snappy, matching the
 * feel of polished in-product messengers. Honors prefers-reduced-motion.
 *
 * Every view here is a lazy() component, so each transition carries its own
 * Suspense boundary — a suspended view shows a centered spinner in place
 * without disturbing the kept-mounted feedback view outside the boundary.
 * The idle-time prefetch makes the fallback a cold-cache-only sight.
 */
function ViewTransition({
  id,
  kind,
  children,
}: {
  id: string
  kind: 'root' | 'push'
  children: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      key={id}
      initial={
        reduceMotion ? false : kind === 'push' ? { x: 28, opacity: 0 } : { y: 10, opacity: 0 }
      }
      animate={{ x: 0, y: 0, opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="h-full"
    >
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" />
          </div>
        }
      >
        {children}
      </Suspense>
    </motion.div>
  )
}

function WidgetPage() {
  const {
    posts,
    postsHasMore,
    statuses,
    boards,
    orgSlug,
    boardPermissions,
    tabs,
    linkPreviews,
    defaultBoard,
    portalAccess,
    portalOrigin,
    home,
    translations,
    logoUrl,
    topArticles,
    teamName,
    assistant,
    team,
    messengerEnabled,
  } = Route.useLoaderData()
  const { ensureSession, sessionVersion } = useWidgetAuth()

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
    enabled: !!tabs.feedback,
  })

  const { c: resumeConversationId } = Route.useSearch()
  const initialTab = resolveInitialTab(tabs)
  // A `?c=` deep link opens straight to Messenger (when Messenger is enabled); the widget
  // then loads the visitor's active conversation from their session.
  const [view, setView] = useState<WidgetView>(
    resumeConversationId && tabs.messages ? 'messenger' : resolveInitialView(tabs)
  )
  const [activeTab, setActiveTab] = useState<WidgetTab>(
    resumeConversationId && tabs.messages ? 'messages' : initialTab
  )
  // Which thread the messenger view opens: an id, 'new', or null (active/default).
  // Seeded from the ?c= deep link so it opens that exact thread.
  const [conversationTarget, setConversationTarget] = useState<ConversationId | 'new' | null>(
    resumeConversationId ? (resumeConversationId as ConversationId) : null
  )
  // Manual size preference: the header's expand/collapse button flips this,
  // and it is STICKY — collapsing turns auto-expansion off for every later
  // item view until the visitor expands again. Persisted per browser.
  const [autoExpand, setAutoExpand] = useState(true)
  useEffect(() => {
    try {
      setAutoExpand(window.localStorage.getItem('quackback:auto-expand') !== 'off')
    } catch {
      /* storage unavailable — keep the default */
    }
  }, [])
  const toggleExpand = useCallback(() => {
    setAutoExpand((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('quackback:auto-expand', next ? 'on' : 'off')
      } catch {
        /* best-effort persistence */
      }
      return next
    })
  }, [])
  // Host viewport class, reported by the SDK (quackback:mobile). On mobile the
  // panel is always full-screen, so the manual size control is meaningless.
  const [hostIsMobile, setHostIsMobile] = useState(false)

  // Warm the lazy view chunks once the first paint has settled, so tab
  // clicks resolve from cache instead of hitting the network. Idle-time only:
  // first paint must never compete with these fetches.
  useEffect(() => {
    const prefetch = () => {
      for (const load of LAZY_VIEW_LOADERS) void load().catch(() => {})
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(prefetch, 1500)
    return () => window.clearTimeout(timer)
  }, [])

  // Where a cross-navigation came from (e.g. Home's "Search for help" jumping
  // to the Help tab). While set, even a ROOT view shows a back chevron that
  // returns here. Cleared by any tab-bar click — tabs never show a back arrow.
  const [backTarget, setBackTarget] = useState<{ tab: WidgetTab; view: WidgetView } | null>(null)

  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [selectedChangelogId, setSelectedChangelogId] = useState<string | null>(null)
  const [selectedHelpSlug, setSelectedHelpSlug] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<{
    id: string
    name: string
    icon: string | null
  } | null>(null)
  const [createdPosts, setCreatedPosts] = useState<typeof posts>([])

  const allPosts = useMemo(() => {
    const createdIds = new Set(createdPosts.map((p) => p.id))
    return [...createdPosts, ...posts.filter((p) => !createdIds.has(p.id))]
  }, [posts, createdPosts])

  const openMessenger = useCallback((target?: ConversationId | 'new') => {
    setConversationTarget(target ?? null)
    setActiveTab('messages')
    setView('messenger')
  }, [])

  // Long-form content reads better wide: ask the host SDK to grow the panel
  // while an article or changelog entry is open, and shrink it back after.
  const panelExpanded = isExpandedView(view) && autoExpand
  useEffect(() => {
    // The tab bar fades out concurrently as the panel grows; on the way back
    // the panel shrinks first and the bar fades in once it has settled (the
    // shell delays its reveal).
    sendToHost({ type: 'quackback:expand', expanded: panelExpanded })
  }, [panelExpanded])

  // Listen for quackback:open messages from the SDK
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const msg = event.data
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'quackback:mobile') {
        setHostIsMobile(!!msg.data)
        return
      }
      if (msg.type !== 'quackback:open' || !msg.data) return

      const opts = msg.data as { view?: string }
      // SDK-driven opens are tab-level landings: no back-chevron origin.
      setBackTarget(null)
      if (opts.view === 'changelog' && tabs.changelog) {
        setActiveTab('changelog')
        setView('changelog')
      } else if (opts.view === 'help' && tabs.help) {
        setActiveTab('help')
        setView('help')
      } else if (
        (opts.view === 'messages' || opts.view === 'chat' || opts.view === 'live-chat') &&
        tabs.messages
      ) {
        openMessenger()
      } else if (opts.view === 'tickets' && tabs.messages) {
        // Legacy SDK target: ticket threads now live in the Messages list.
        setActiveTab('messages')
        setView('messages')
      } else if ((opts.view === 'home' || opts.view === 'overview') && homeEnabled(tabs)) {
        setActiveTab('home')
        setView('overview')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tabs, openMessenger])

  const handlePostCreated = useCallback((post: SuccessPost) => {
    setCreatedPosts((prev) => [
      {
        id: post.id as (typeof prev)[number]['id'],
        title: post.title,
        voteCount: post.voteCount,
        statusId: post.statusId as (typeof prev)[number]['statusId'],
        commentCount: 0,
        board: post.board as (typeof prev)[number]['board'],
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
    if (view === 'messenger') {
      // Messenger opens from the Messages tab; back returns to the conversation list.
      setView('messages')
      return
    }
    // Root views only show a back arrow after a cross-navigation (e.g. a Home
    // card jumped here); back returns to that origin and consumes it.
    if (
      backTarget &&
      (view === 'overview' ||
        view === 'messages' ||
        view === 'feedback' ||
        view === 'help' ||
        view === 'changelog')
    ) {
      setActiveTab(backTarget.tab)
      setView(backTarget.view)
      setBackTarget(null)
      return
    }
    setSelectedPostId(null)
    setView('feedback')
  }, [view, selectedCategory, backTarget])

  const navigateToTab = useCallback((tab: WidgetTab) => {
    setActiveTab(tab)
    if (tab === 'home') {
      setView('overview')
    } else if (tab === 'messages') {
      setConversationTarget(null)
      setView('messages')
    } else if (tab === 'feedback') {
      setSelectedPostId(null)
      setView('feedback')
    } else if (tab === 'changelog') {
      setSelectedChangelogId(null)
      setView('changelog')
    } else {
      // 'help' — the knowledge-base articles surface
      setSelectedHelpSlug(null)
      setSelectedCategory(null)
      setView('help')
    }
  }, [])

  // Tab-bar navigation: tabs are peers, so landing on one never shows a back
  // arrow — any pending cross-navigation origin is dropped.
  const handleTabChange = useCallback(
    (tab: WidgetTab) => {
      setBackTarget(null)
      navigateToTab(tab)
    },
    [navigateToTab]
  )

  // Cross-navigation (e.g. a Home card jumping to another surface): remember
  // the origin so the destination shows a back chevron returning here.
  const crossNavigate = useCallback(
    (tab: WidgetTab) => {
      setBackTarget({ tab: activeTab, view })
      navigateToTab(tab)
    },
    [activeTab, view, navigateToTab]
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

  // Detail views always get a back arrow; root views only when a
  // cross-navigation origin is pending (tab-bar landings never show one).
  const isRootView =
    view === 'overview' ||
    view === 'feedback' ||
    view === 'changelog' ||
    view === 'help' ||
    view === 'messages'
  const shellOnBack = !isRootView || backTarget ? handleBack : undefined

  // Messenger thread header lives in the SHELL's top bar (single header row):
  // the assistant identity when enabled — always available, no presence — or
  // the live presence badge for assistant-less workspaces.
  const presence = useConversationPresence(messengerEnabled && !assistant)
  const messengerHeader =
    view === 'messenger' ? (
      assistant ? (
        <div className="flex min-w-0 items-center gap-2.5 ps-1">
          <Avatar src={assistant.avatarUrl} name={assistant.name} className="size-8 text-xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              {assistant.name}
            </p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              <FormattedMessage
                id="widget.messenger.assistant.teamAlso"
                defaultMessage="The team can also help"
              />
            </p>
          </div>
        </div>
      ) : (
        <div className="ps-1">
          <ConversationPresenceBadge
            available={conversationAvailable(presence.agentsOnline, presence.withinOfficeHours)}
          />
        </div>
      )
    ) : undefined

  return (
    <WidgetShell
      orgSlug={orgSlug}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      onBack={shellOnBack}
      enabledTabs={tabs}
      portalAccess={portalAccess}
      portalOrigin={portalOrigin}
      team={team}
      logoUrl={(home?.showLogo ?? true) ? logoUrl : null}
      headerContent={messengerHeader}
      // The hero backdrop belongs to Home only; detail views keep a plain panel.
      backdrop={view === 'overview' ? <WidgetHeroBackdrop home={home} /> : undefined}
      // Immersive views: the conversation thread and single-item reading views
      // (post/article/changelog) drop the tab bar; the back chevron handles exit.
      hideTabBar={view === 'messenger' || isExpandedView(view)}
      panelExpanded={panelExpanded}
      expandControl={
        isExpandedView(view) && !hostIsMobile
          ? { expanded: panelExpanded, onToggle: toggleExpand }
          : undefined
      }
    >
      {view === 'overview' && (
        <ViewTransition id="overview" kind="root">
          <WidgetOverview
            tabs={tabs}
            home={home}
            translations={translations ?? undefined}
            assistant={assistant}
            team={team}
            topArticles={topArticles}
            canStartConversation={messengerEnabled}
            onLeaveFeedback={() => crossNavigate('feedback')}
            onOpenHelp={() => crossNavigate('help')}
            onOpenHelpArticle={(slug) => {
              setBackTarget({ tab: 'home', view: 'overview' })
              setActiveTab('help')
              handleHelpArticleSelect(slug)
            }}
            onStartConversation={() => {
              setBackTarget({ tab: 'home', view: 'overview' })
              openMessenger('new')
            }}
            onResumeMessenger={() => {
              setBackTarget({ tab: 'home', view: 'overview' })
              openMessenger()
            }}
            onSeeChangelog={() => crossNavigate('changelog')}
            onOpenChangelogEntry={(id) => {
              setBackTarget({ tab: 'home', view: 'overview' })
              setActiveTab('changelog')
              handleChangelogEntrySelect(id)
            }}
          />
        </ViewTransition>
      )}

      {view === 'changelog' && (
        <ViewTransition id="changelog" kind="root">
          <WidgetChangelog teamName={teamName} onEntrySelect={handleChangelogEntrySelect} />
        </ViewTransition>
      )}

      {view === 'messenger' && (
        <ViewTransition id={`messenger-${conversationTarget ?? 'active'}`} kind="push">
          <WidgetMessenger
            key={conversationTarget ?? 'active'}
            helpEnabled={tabs.help}
            onArticleSelect={handleHelpArticleSelect}
            conversationTarget={conversationTarget === null ? undefined : conversationTarget}
            linkPreviews={linkPreviews}
          />
        </ViewTransition>
      )}

      {view === 'messages' && (
        <ViewTransition id="messages" kind="root">
          <WidgetMessages
            teamName={teamName}
            assistant={assistant}
            canStartConversation={messengerEnabled}
            onOpenMessenger={openMessenger}
          />
        </ViewTransition>
      )}

      {view === 'changelog-detail' && selectedChangelogId && (
        <ViewTransition id={`changelog-${selectedChangelogId}`} kind="push">
          <WidgetChangelogDetail entryId={selectedChangelogId} />
        </ViewTransition>
      )}

      {view === 'help' && (
        <ViewTransition id="help" kind="root">
          <WidgetHelp
            onArticleSelect={handleHelpArticleSelect}
            onCategorySelect={handleHelpCategorySelect}
          />
        </ViewTransition>
      )}

      {view === 'help-category' && selectedCategory && (
        <ViewTransition id={`help-category-${selectedCategory.id}`} kind="push">
          <WidgetHelpCategory
            categoryId={selectedCategory.id}
            categoryName={selectedCategory.name}
            categoryIcon={selectedCategory.icon}
            onArticleSelect={handleHelpCategoryArticleSelect}
          />
        </ViewTransition>
      )}

      {view === 'help-detail' && selectedHelpSlug && (
        <ViewTransition id={`help-detail-${selectedHelpSlug}`} kind="push">
          <WidgetHelpDetail articleSlug={selectedHelpSlug} />
        </ViewTransition>
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
        {/* Kept mounted, so it can't use the remount-keyed ViewTransition;
            instead the same root entrance replays whenever it becomes visible. */}
        <motion.div
          initial={false}
          animate={view === 'feedback' ? { y: 0, opacity: 1 } : { y: 10, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="flex flex-col h-full"
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
          />
        </motion.div>
      </div>

      {view === 'post-detail' && selectedPostId && (
        <ViewTransition id={`post-${selectedPostId}`} kind="push">
          <WidgetPostDetail postId={selectedPostId} statuses={statuses} />
        </ViewTransition>
      )}

      {view === 'success' && successPost && (
        <ViewTransition id={`success-${successPost.id}`} kind="push">
          <SuccessView
            post={successPost}
            status={
              successPost.statusId
                ? (statuses.find((s) => s.id === successPost.statusId) ?? null)
                : null
            }
            // Vote gate follows the created post's board for the real actor
            // (livePermissions is refetched with the widget's Bearer identity).
            canVote={livePermissions?.[successPost.board.id]?.canVote ?? false}
            ensureSession={ensureSession}
            onOpenPost={() => {
              setSelectedPostId(successPost.id)
              setView('post-detail')
            }}
            onBack={handleBack}
          />
        </ViewTransition>
      )}
    </WidgetShell>
  )
}

/** Post-submission confirmation: the created post with its vote button. */
function SuccessView({
  post,
  status,
  canVote,
  ensureSession,
  onOpenPost,
  onBack,
}: {
  post: SuccessPost
  status: { id: string; name: string; color: string } | null
  canVote: boolean
  ensureSession: () => Promise<boolean>
  onOpenPost: () => void
  onBack: () => void
}) {
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
          onClick={onOpenPost}
        >
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <WidgetVoteButton
              postId={post.id as PostId}
              voteCount={post.voteCount}
              onBeforeVote={canVote ? ensureSession : undefined}
              noAccessReason={canVote ? undefined : "You don't have access to vote on this board"}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground line-clamp-2">{post.title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              {status && (
                <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.name}
                </span>
              )}
              <span className="text-xs text-muted-foreground/60">{post.board.name}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-foreground bg-muted/30 hover:bg-muted/50 rounded-lg border border-border/50 transition-colors"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" />
          Back to ideas
        </button>
      </div>
    </div>
  )
}
