import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { WidgetVoteButton } from '@/components/widget/widget-vote-button'
import type { PostId } from '@featurepool/ids'
import { WidgetShell, type WidgetTab } from '@/components/widget/widget-shell'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetPostDetail } from '@/components/widget/widget-post-detail'
import { WidgetChangelog } from '@/components/widget/widget-changelog'
import { WidgetChangelogDetail } from '@/components/widget/widget-changelog-detail'
import { WidgetHelp } from '@/components/widget/widget-help'
import { WidgetHelpDetail } from '@/components/widget/widget-help-detail'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { portalQueries } from '@/lib/client/queries/portal'
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
      boards: portalData.boards
        .filter((b) => b.isPublic)
        .map((b) => ({
          id: b.id as string,
          name: b.name,
          slug: b.slug,
        })),
      orgSlug: settings?.slug ?? '',
      features: {
        anonymousVoting: settings?.publicPortalConfig?.features?.anonymousVoting ?? true,
        anonymousCommenting: settings?.publicPortalConfig?.features?.anonymousCommenting ?? false,
        anonymousPosting: settings?.publicPortalConfig?.features?.anonymousPosting ?? false,
      },
      tabs: {
        feedback: settings?.publicWidgetConfig?.tabs?.feedback ?? true,
        changelog: settings?.publicWidgetConfig?.tabs?.changelog ?? false,
        help: (settings?.featureFlags as { helpCenter?: boolean } | undefined)?.helpCenter ?? false,
      },
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
  | 'help-detail'

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
}

function WidgetPage() {
  const { posts, postsHasMore, statuses, boards, orgSlug, features, tabs } = Route.useLoaderData()
  const { isIdentified, ensureSession } = useWidgetAuth()
  const canVote = isIdentified || features.anonymousVoting

  const initialTab: WidgetTab = tabs.feedback ? 'feedback' : tabs.changelog ? 'changelog' : 'help'
  const [view, setView] = useState<WidgetView>(
    initialTab === 'changelog' ? 'changelog' : initialTab === 'help' ? 'help' : 'home'
  )
  const [activeTab, setActiveTab] = useState<WidgetTab>(initialTab)
  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)
  const [selectedChangelogId, setSelectedChangelogId] = useState<string | null>(null)
  const [selectedHelpSlug, setSelectedHelpSlug] = useState<string | null>(null)
  const [createdPosts, setCreatedPosts] = useState<typeof posts>([])

  const allPosts = useMemo(() => {
    const createdIds = new Set(createdPosts.map((p) => p.id))
    return [...createdPosts, ...posts.filter((p) => !createdIds.has(p.id))]
  }, [posts, createdPosts])

  // Listen for featurepool:open messages from the SDK
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const msg = event.data
      if (!msg || typeof msg !== 'object' || msg.type !== 'featurepool:open' || !msg.data) return

      const opts = msg.data as { view?: string }
      if (opts.view === 'changelog' && tabs.changelog) {
        setActiveTab('changelog')
        setView('changelog')
      } else if (opts.view === 'help' && tabs.help) {
        setActiveTab('help')
        setView('help')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [tabs.changelog, tabs.help])

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
      setView('help')
      return
    }
    setSelectedPostId(null)
    setView('home')
  }, [view])

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

  const shellOnBack =
    view !== 'home' && view !== 'changelog' && view !== 'help' ? handleBack : undefined

  return (
    <WidgetShell
      orgSlug={orgSlug}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      onBack={shellOnBack}
      enabledTabs={tabs}
    >
      {view === 'changelog' && <WidgetChangelog onEntrySelect={handleChangelogEntrySelect} />}

      {view === 'changelog-detail' && selectedChangelogId && (
        <WidgetChangelogDetail entryId={selectedChangelogId} />
      )}

      {view === 'help' && <WidgetHelp onArticleSelect={handleHelpArticleSelect} />}

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
          onPostSelect={handlePostSelect}
          onPostCreated={handlePostCreated}
          anonymousVotingEnabled={features.anonymousVoting}
          anonymousPostingEnabled={features.anonymousPosting}
        />
      </div>

      {view === 'post-detail' && selectedPostId && (
        <WidgetPostDetail
          postId={selectedPostId}
          statuses={statuses}
          anonymousVotingEnabled={features.anonymousVoting}
          anonymousCommentingEnabled={features.anonymousCommenting}
        />
      )}

      {view === 'success' &&
        successPost &&
        (() => {
          const successStatus = successPost.statusId
            ? (statuses.find(
                (s: { id: string; name: string; color: string }) => s.id === successPost.statusId
              ) ?? null)
            : null

          return (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 shrink-0">
                  <CheckCircleIcon className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Obrigado pelo seu feedback!
                  </p>
                  <p className="text-[11px] text-muted-foreground">Sua ideia foi enviada.</p>
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
