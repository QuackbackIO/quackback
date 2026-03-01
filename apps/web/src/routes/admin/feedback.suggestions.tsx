import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { adminQueries } from '@/lib/client/queries/admin'
import { SuggestionsContainer } from '@/components/admin/feedback/suggestions/suggestions-container'

export const Route = createFileRoute('/admin/feedback/suggestions')({
  loaderDeps: ({ search }) => ({
    suggestionType: search.suggestionType,
    suggestionSort: search.suggestionSort,
  }),
  loader: async ({ context, deps }) => {
    const { queryClient } = context

    await Promise.all([
      queryClient.ensureQueryData(
        feedbackQueries.suggestions({
          status: 'pending',
          suggestionType: deps.suggestionType,
          sort: deps.suggestionSort,
        })
      ),
      queryClient.ensureQueryData(feedbackQueries.suggestionStats()),
      queryClient.ensureQueryData(feedbackQueries.sources()),
      queryClient.ensureQueryData(adminQueries.boards()),
    ])
  },
  component: SuggestionsPage,
})

function SuggestionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      }
    >
      <SuggestionsContainer />
    </Suspense>
  )
}
