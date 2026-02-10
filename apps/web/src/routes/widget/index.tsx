import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useState, useEffect, useCallback } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { WidgetShell } from '@/components/widget/widget-shell'
import { WidgetHome } from '@/components/widget/widget-home'
import { WidgetNewPostForm } from '@/components/widget/widget-new-post-form'
import { useWidgetAuth } from '@/components/widget/widget-auth-provider'
import { portalQueries } from '@/lib/client/queries/portal'

const searchSchema = z.object({
  board: z.string().optional(),
})

export const Route = createFileRoute('/widget/')({
  validateSearch: searchSchema,
  loader: async ({ context, location }) => {
    const { queryClient, settings } = context
    const search = location.search as z.infer<typeof searchSchema>

    const portalData = await queryClient.ensureQueryData(
      portalQueries.portalData({
        boardSlug: search.board,
        sort: 'top',
      })
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
      orgName: settings?.name ?? '',
      orgSlug: settings?.slug ?? '',
      logoUrl: settings?.brandingData?.logoUrl ?? null,
    }
  },
  component: WidgetPage,
})

type WidgetView = 'home' | 'new-post' | 'success'

interface SuccessPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  board: { id: string; name: string; slug: string }
}

function WidgetPage() {
  const { posts, statuses, boards, defaultBoard, orgName, orgSlug, logoUrl } = Route.useLoaderData()
  const { isIdentified, closeWidget } = useWidgetAuth()

  const [view, setView] = useState<WidgetView>('home')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBoardSlug, setSelectedBoardSlug] = useState<string | undefined>(defaultBoard)
  const [prefilledTitle, setPrefilledTitle] = useState('')
  const [successPost, setSuccessPost] = useState<SuccessPost | null>(null)
  const [countdown, setCountdown] = useState(3)

  const handleSubmitNew = useCallback(
    (title: string) => {
      if (!isIdentified) return
      setPrefilledTitle(title)
      setView('new-post')
    },
    [isIdentified]
  )

  const handlePostSuccess = useCallback((post: SuccessPost) => {
    setSuccessPost(post)
    setCountdown(3)
    setView('success')
  }, [])

  const handleBack = useCallback(() => {
    setView('home')
  }, [])

  // Auto-close countdown
  useEffect(() => {
    if (view !== 'success') return

    if (countdown <= 0) {
      closeWidget()
      return
    }

    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [view, countdown, closeWidget])

  // Shell props based on view
  const shellTitle = view === 'new-post' ? 'New idea' : undefined
  const shellOnBack = view === 'new-post' ? handleBack : undefined

  return (
    <WidgetShell
      orgName={orgName}
      orgSlug={orgSlug}
      logoUrl={logoUrl}
      title={shellTitle}
      onBack={shellOnBack}
    >
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
        />
      )}

      {view === 'new-post' && (
        <WidgetNewPostForm
          boards={boards}
          prefilledTitle={prefilledTitle}
          selectedBoardSlug={selectedBoardSlug}
          onSuccess={handlePostSuccess}
        />
      )}

      {view === 'success' && successPost && (
        <div className="flex flex-col items-center justify-center h-full px-4 text-center">
          <CheckCircleIcon className="w-10 h-10 text-primary mb-3" />
          <p className="text-sm font-semibold text-foreground">Idea submitted!</p>
          <p className="text-xs text-muted-foreground mt-0.5">Thank you for your feedback</p>

          <div className="w-full mt-4 rounded-lg border border-border p-3 text-left">
            <p className="text-sm font-medium text-foreground line-clamp-1">{successPost.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{successPost.board.name}</p>
          </div>

          <p className="text-xs text-muted-foreground/60 mt-4">Auto-closing in {countdown}s...</p>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => {
                setView('home')
                setSearchQuery('')
              }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Keep open
            </button>
            <button
              type="button"
              onClick={closeWidget}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Close now
            </button>
          </div>
        </div>
      )}
    </WidgetShell>
  )
}
