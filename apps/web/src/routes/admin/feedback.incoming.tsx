import { Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { feedbackQueries } from '@/lib/client/queries/feedback'
import { SuggestionsContainer } from '@/components/admin/feedback/suggestions/suggestions-container'
import { Spinner } from '@/components/shared/spinner'

export const Route = createFileRoute('/admin/feedback/incoming')({
  loaderDeps: ({ search }) => ({
    suggestionSort: search.suggestionSort,
    suggestionStatus: search.suggestionStatus,
  }),
  loader: async ({ context, deps }) => {
    const { queryClient } = context

    await Promise.all([
      queryClient.ensureQueryData(
        feedbackQueries.suggestions({
          status: deps.suggestionStatus ?? 'pending',
          sort: deps.suggestionSort,
        })
      ),
      queryClient.ensureQueryData(feedbackQueries.sources()),
    ])
  },
  component: IncomingPage,
})

function IncomingPage() {
  const deps = Route.useLoaderDeps()

  const suggestionsQuery = useSuspenseQuery(
    feedbackQueries.suggestions({
      status: deps.suggestionStatus ?? 'pending',
      sort: deps.suggestionSort,
    })
  )

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Spinner />
        </div>
      }
    >
      <SuggestionsContainer initialSuggestions={suggestionsQuery.data} />
    </Suspense>
  )
}
