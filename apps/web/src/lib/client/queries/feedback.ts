import { queryOptions } from '@tanstack/react-query'
import {
  fetchSuggestions,
  fetchSuggestionDetail,
  fetchSuggestionStats,
  fetchFeedbackPipelineStats,
  fetchFeedbackSources,
} from '@/lib/server/functions/feedback'

/**
 * Query options factory for feedback aggregation routes.
 */
export const feedbackQueries = {
  suggestions: (filters?: {
    status?: 'pending' | 'accepted' | 'dismissed' | 'expired'
    suggestionType?: 'merge_post' | 'create_post'
    boardId?: string
    sourceIds?: string[]
    sort?: 'newest' | 'similarity' | 'confidence'
    limit?: number
    offset?: number
  }) =>
    queryOptions({
      queryKey: ['feedback', 'suggestions', filters],
      queryFn: () => fetchSuggestions({ data: filters ?? {} }),
      staleTime: 15 * 1000,
    }),

  suggestionDetail: (id: string) =>
    queryOptions({
      queryKey: ['feedback', 'suggestion', id],
      queryFn: () => fetchSuggestionDetail({ data: { id } }),
      staleTime: 10 * 1000,
    }),

  suggestionStats: () =>
    queryOptions({
      queryKey: ['feedback', 'suggestionStats'],
      queryFn: () => fetchSuggestionStats(),
      staleTime: 10 * 1000,
    }),

  sources: () =>
    queryOptions({
      queryKey: ['feedback', 'sources'],
      queryFn: () => fetchFeedbackSources(),
      staleTime: 60 * 1000,
    }),

  pipelineStats: () =>
    queryOptions({
      queryKey: ['feedback', 'pipelineStats'],
      queryFn: () => fetchFeedbackPipelineStats(),
      staleTime: 10 * 1000,
    }),
}
