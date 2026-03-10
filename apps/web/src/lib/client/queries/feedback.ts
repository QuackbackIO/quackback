import { queryOptions } from '@tanstack/react-query'
import {
  fetchSuggestions,
  fetchFeedbackSources,
  fetchIncomingSuggestionCount,
} from '@/lib/server/functions/feedback'
import type { SuggestionsPageResult } from '@/lib/client/hooks/use-suggestions-query'

/**
 * Query options factory for feedback aggregation routes.
 */
export const feedbackQueries = {
  suggestions: (filters?: {
    status?: 'pending' | 'accepted' | 'dismissed' | 'expired'
    suggestionType?: 'create_post' | 'vote_on_post' | 'duplicate_post'
    boardId?: string
    sourceIds?: string[]
    sort?: 'newest' | 'relevance'
    limit?: number
    offset?: number
  }) =>
    queryOptions({
      queryKey: ['feedback', 'suggestions', filters],
      queryFn: () => fetchSuggestions({ data: filters ?? {} }) as Promise<SuggestionsPageResult>,
      staleTime: 15 * 1000,
    }),

  sources: () =>
    queryOptions({
      queryKey: ['feedback', 'sources'],
      queryFn: () => fetchFeedbackSources(),
      staleTime: 60 * 1000,
    }),

  incomingCount: () =>
    queryOptions({
      queryKey: ['feedback', 'incoming-count'],
      queryFn: () => fetchIncomingSuggestionCount(),
      staleTime: 60 * 1000,
    }),
}
