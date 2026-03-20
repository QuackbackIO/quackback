import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useState, useCallback, useEffect } from 'react'
import { CheckCircleIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { WidgetVoteButton } from '@/components/widget/widget-vote-button'
import type { PostId } from '@quackback/ids'
import { WidgetShell } from '@/components/widget/widget-shell'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetNewPostForm } from '@/components/widget/widget-new-post-form'
import { WidgetPostDetail } from '@/components/widget/widget-post-detail'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { portalQueries } from '@/lib/client/queries/portal'
import { widgetQueryKeys, INITIAL_SESSION_VERSION } from '@/lib/client/hooks/use-widget-vote'
import { generateOneTimeToken } from '@/lib/client/widget-auth'

const searchSchema = z.object({
  board: z.string().optional(),
})

export const Route = createFileRoute('/widget/')({
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    const { queryClient, settings, session } = context
    const search = location.search as z.infer<typeof searchSchema>

    // Pass userId when session cookie is available (e.g. Chrome iframes,
    // direct navigation) so votedPostIds are included in SSR data.
    const portalData = await queryClient.ensureQueryData(
      portalQueries.portalData({
        boardSlug: search.board,
        sort: 'top',
        userId: session?.user?.id,
      })
    )

    // Seed the widget votedPosts cache for SSR vote highlights.
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
      defaultBoard: search.board,
      orgSlug: settings?.slug ?? '',
      features: {
        anonymousVoting: settings?.publicPortalConfig?.features?.anonymousVoting ?? true,
        anonymousCommenting: settings?.publicPortalConfig?.features?.anonymousCommenting ?? false,
        anonymousPosting: settings?.publicPortalConfig?.features?.anonymousPosting ?? false,
      },
    }
  },
  component: WidgetPage,
})

type WidgetView = 'home' | 'new-post' | 'post-detail' | 'success'

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
}

function WidgetPage() {
  const { posts, statuses, boards, defaultBoard, orgSlug, features } = Route.useLoaderData()
  const { isIdentified, closeWidget, ensureSession } = useWidgetAuth()
  const canVote = isIdentified || features.anonymousVoting

  const [view, setView] = useState<WidgetView>('home')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBoardSlug, setSelectedBoardSlug] = useState<string | undefined>(defaultBoard)
  const [prefilledTitle, setPrefilledTitle] = useState('')
  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null)

  // Listen for quackback:open messages from the SDK
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const msg = event.data
      if (!msg || typeof msg !== 'object' || msg.type !== 'quackback:open' || !msg.data) return

      const opts = msg.data as { view?: string; title?: string; board?: string }
      if (opts.view === 'new-post') {
        if (opts.title) setPrefilledTitle(opts.title)
        if (opts.board) setSelectedBoardSlug(opts.board)
        setView('new-post')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const canPost = isIdentified || features.anonymousPosting
  const handleSubmitNew = useCallback(
    async (title: string) => {
      if (!canPost) return
      // Ensure session exists for anonymous posters
      if (!isIdentified) {
        const ok = await ensureSession()
        if (!ok) return
      }
      setPrefilledTitle(title)
      setView('new-post')
    },
    [canPost, isIdentified, ensureSession]
  )

  const handlePostSuccess = useCallback((post: SuccessPost) => {
    setSuccessPost(post)
    setView('success')
  }, [])

  const handlePostSelect = useCallback((postId: string) => {
    setSelectedPostId(postId)
    setView('post-detail')
  }, [])

  const handleBack = useCallback(() => {
    setSelectedPostId(null)
    setView('home')
  }, [])

  // Shell props based on view
  const shellOnBack = view === 'new-post' || view === 'post-detail' ? handleBack : undefined

  return (
    <WidgetShell orgSlug={orgSlug} onBack={shellOnBack}>
      {view === 'home' && (
        <WidgetHome
          initialPosts={posts}
          statuses={statuses}
          boards={boards}
          defaultBoard={defaultBoard}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          selectedBoardSlug={selectedBoardSlug}
          onBoardChange={setSelectedBoardSlug}
          onSubmitNew={handleSubmitNew}
          onPostSelect={handlePostSelect}
          anonymousVotingEnabled={features.anonymousVoting}
        />
      )}

      {view === 'post-detail' && selectedPostId && (
        <WidgetPostDetail
          postId={selectedPostId}
          statuses={statuses}
          anonymousVotingEnabled={features.anonymousVoting}
          anonymousCommentingEnabled={features.anonymousCommenting}
        />
      )}

      {view === 'new-post' && (
        <WidgetNewPostForm
          boards={boards}
          prefilledTitle={prefilledTitle}
          selectedBoardSlug={selectedBoardSlug}
          onSuccess={handlePostSuccess}
          anonymousPostingEnabled={features.anonymousPosting}
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
              {/* Success header */}
              <div className="flex items-center gap-2.5 px-4 pt-5 pb-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/15 shrink-0">
                  <CheckCircleIcon className="w-4.5 h-4.5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Thanks for your feedback!</p>
                  <p className="text-[11px] text-muted-foreground">Your idea has been submitted.</p>
                </div>
              </div>

              {/* Post card — same format as the list view */}
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
                      onAuthRequired={
                        !canVote
                          ? () => {
                              const url = `${window.location.origin}/b/${successPost.board.slug}/posts/${successPost.id}`
                              window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
                            }
                          : undefined
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

              {/* Actions */}
              <div className="px-4 pt-3 space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    let url = `${window.location.origin}/b/${successPost.board.slug}/posts/${successPost.id}`
                    const ott = await generateOneTimeToken()
                    if (ott) url += `?ott=${encodeURIComponent(ott)}`
                    window.parent.postMessage({ type: 'quackback:navigate', url }, '*')
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                >
                  View on feedback board
                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </button>
              </div>

              {/* Spacer + close at bottom */}
              <div className="mt-auto px-4 pb-4 pt-3 flex justify-center">
                <button
                  type="button"
                  onClick={closeWidget}
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Close widget
                </button>
              </div>
            </div>
          )
        })()}
    </WidgetShell>
  )
}
