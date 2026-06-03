import { createFileRoute } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { WidgetVoteButton } from '@/components/widget/widget-vote-button'
import type { PostId } from '@quackback/ids'
import { WidgetShell, type WidgetTab } from '@/components/widget/widget-shell'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetPostDetail } from '@/components/widget/widget-post-detail'
import { WidgetChangelog } from '@/components/widget/widget-changelog'
import { WidgetChangelogDetail } from '@/components/widget/widget-changelog-detail'
import { WidgetHelp } from '@/components/widget/widget-help'
import { WidgetHelpCategory } from '@/components/widget/widget-help-category'
import { WidgetHelpDetail } from '@/components/widget/widget-help-detail'
import { WidgetSupportCard } from '@/components/widget/widget-support-card'
import { WidgetSupportList } from '@/components/widget/widget-support-list'
import { WidgetSupportNew } from '@/components/widget/widget-support-new'
import { WidgetSupportDetail } from '@/components/widget/widget-support-detail'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { portalQueries } from '@/lib/client/queries/portal'
import { fetchBoardCapabilitiesFn } from '@/lib/server/functions/portal'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { widgetQueryKeys, INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'

const searchSchema = z.object({
  board: z.string().optional(),
})

export const Route = createFileRoute('/widget/')({
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    const { queryClient, settings, session } = context
    const search = location.search as z.infer<typeof searchSchema>

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

    const { getBaseUrl } = await import('@/lib/server/config')

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
        feedback: settings?.publicWidgetConfig?.tabs?.feedback ?? true,
        changelog: settings?.publicWidgetConfig?.tabs?.changelog ?? false,
        help:
          ((settings?.featureFlags as { helpCenter?: boolean } | undefined)?.helpCenter ?? false) &&
          (settings?.helpCenterConfig?.enabled ?? false) &&
          (settings?.publicWidgetConfig?.tabs?.help ?? false),
      },
      imageUploadsInWidget: settings?.publicWidgetConfig?.imageUploadsInWidget ?? true,
      defaultBoard: settings?.publicWidgetConfig?.defaultBoard,
      ticketingEnabled: settings?.publicWidgetConfig?.ticketing?.enabled ?? false,
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

type WidgetView =
  | 'home'
  | 'post-detail'
  | 'success'
  | 'changelog'
  | 'changelog-detail'
  | 'help'
  | 'help-category'
  | 'help-detail'
  | 'support-list'
  | 'support-new'
  | 'support-detail'

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
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
    imageUploadsInWidget,
    defaultBoard,
    ticketingEnabled,
    portalAccess,
    portalOrigin,
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
  })

  const initialTab: WidgetTab = tabs.feedback ? 'feedback' : tabs.changelog ? 'changelog' : 'help'
  const [view, setView] = useState<WidgetView>(
    initialTab === 'changelog' ? 'changelog' : initialTab === 'help' ? 'help' : 'home'
  )
  const [activeTab, setActiveTab] = useState<WidgetTab>(initialTab)
  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [selectedChangelogId, setSelectedChangelogId] = useState<string | null>(null)
  const [selectedHelpSlug, setSelectedHelpSlug] = useState<string | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<{
    id: string
    name: string
    icon: string | null
  } | null>(null)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [createdPosts, setCreatedPosts] = useState<typeof posts>([])

  const allPosts = useMemo(() => {
    const createdIds = new Set(createdPosts.map((p) => p.id))
    return [...createdPosts, ...posts.filter((p) => !createdIds.has(p.id))]
  }, [posts, createdPosts])

  // Listen for quackback:open messages from the SDK
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const msg = event.data
      if (!msg || typeof msg !== 'object' || msg.type !== 'quackback:open' || !msg.data) return

      const opts = msg.data as { view?: string; ticketId?: string }
      if (opts.view === 'changelog' && tabs.changelog) {
        setActiveTab('changelog')
        setView('changelog')
      } else if (opts.view === 'help' && tabs.help) {
        setActiveTab('help')
        setView('help')
      } else if (opts.view === 'support') {
        if (!ticketingEnabled) return
        setActiveTab('feedback')
        if (opts.ticketId) {
          setSelectedTicketId(opts.ticketId)
          setView('support-detail')
        } else {
          setView('support-list')
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tabs.changelog, tabs.help, ticketingEnabled])

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
    if (view === 'support-detail') {
      setSelectedTicketId(null)
      setView('support-list')
      return
    }
    if (view === 'support-new' || view === 'support-list') {
      setSelectedTicketId(null)
      setView('home')
      return
    }
    setSelectedPostId(null)
    setView('home')
  }, [view, selectedCategory])

  const handleTabChange = useCallback((tab: WidgetTab) => {
    setActiveTab(tab)
    if (tab === 'feedback') {
      setSelectedPostId(null)
      setView('home')
    } else if (tab === 'changelog') {
      setSelectedChangelogId(null)
      setView('changelog')
    } else {
      setSelectedHelpSlug(null)
      setSelectedCategory(null)
      setView('help')
    }
  }, [])

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

  const handleSupportOpen = useCallback(() => {
    if (!ticketingEnabled) return
    setActiveTab('feedback')
    setSelectedTicketId(null)
    setView('support-list')
  }, [ticketingEnabled])

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

  const shellOnBack =
    view !== 'home' && view !== 'changelog' && view !== 'help' ? handleBack : undefined

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
      {view === 'changelog' && <WidgetChangelog onEntrySelect={handleChangelogEntrySelect} />}

      {view === 'changelog-detail' && selectedChangelogId && (
        <WidgetChangelogDetail entryId={selectedChangelogId} />
      )}

      {view === 'help' && (
        <WidgetHelp
          onArticleSelect={handleHelpArticleSelect}
          onCategorySelect={handleHelpCategorySelect}
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
          view === 'home' || view === 'post-detail'
            ? view === 'home'
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
            ticketingEnabled ? <WidgetSupportCard onOpen={handleSupportOpen} /> : undefined
          }
        />
      </div>

      {view === 'support-list' && (
        <WidgetSupportList
          onNewTicket={handleSupportNewTicket}
          onTicketSelect={handleSupportTicketSelect}
        />
      )}

      {view === 'support-new' && <WidgetSupportNew onCreated={handleSupportTicketCreated} />}

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
