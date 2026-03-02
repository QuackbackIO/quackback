import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { SuggestionsContainer } from '@/components/admin/feedback/suggestions/suggestions-container'
import type { SuggestionsPageResult } from '@/lib/client/hooks/use-suggestions-query'

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
    ])
  },
  component: SuggestionsPage,
})

function SuggestionsPage() {
  const deps = Route.useLoaderDeps()

  // Read server-prefetched first page
  const suggestionsQuery = useSuspenseQuery(
    feedbackQueries.suggestions({
      status: 'pending',
      suggestionType: deps.suggestionType,
      sort: deps.suggestionSort,
    })
  )

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      }
    >
      <SuggestionsContainer
        initialSuggestions={suggestionsQuery.data as unknown as SuggestionsPageResult}
      />
    </Suspense>
  )
}
