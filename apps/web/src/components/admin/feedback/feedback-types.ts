/**
 * View types for feedback components.
 *
 * These represent the shapes returned by the feedback server functions
 * and consumed by the UI components.
 */

import type { RawFeedbackAuthor, RawFeedbackContent } from '@/lib/shared/db-types'

// ============================================
// Suggestion Types
// ============================================

/** Suggestion in list view - returned by fetchSuggestions. */
export interface SuggestionListItem {
  id: string
  suggestionType: 'create_post' | 'vote_on_post' | 'duplicate_post'
  status: 'pending' | 'accepted' | 'dismissed' | 'expired'
  similarityScore: number | null
  suggestedTitle: string | null
  suggestedBody: string | null
  reasoning: string | null
  createdAt: string | Date
  updatedAt: string | Date
  rawItem: {
    id: string
    sourceType: string
    externalUrl: string | null
    author: RawFeedbackAuthor
    content: RawFeedbackContent
    sourceCreatedAt: string | Date
    principalId: string | null
    source: {
      id: string
      name: string
      sourceType: string
    } | null
  } | null
  targetPost: {
    id: string
    title: string
    content?: string | null
    voteCount: number
    commentCount?: number
    createdAt?: string | Date
    boardName?: string | null
    statusName?: string | null
    statusColor?: string | null
    status: string
  } | null
  /** Source post (for duplicate_post suggestions only) */
  sourcePost: {
    id: string
    title: string
    content?: string | null
    voteCount: number
    commentCount?: number
    createdAt?: string | Date
    boardName?: string | null
    statusName?: string | null
    statusColor?: string | null
  } | null
  similarPosts: Array<{
    postId: string
    title: string
    similarity: number
    voteCount: number
  }> | null
  board: {
    id: string
    name: string
    slug: string
  } | null
  signal: {
    id: string
    signalType: string
    summary: string
    evidence: string[]
    extractionConfidence: number
  } | null
}

/** Suggestions grouped by source feedback item. */
export interface SuggestionGroup {
  rawItemId: string
  rawItem: SuggestionListItem['rawItem']
  suggestions: SuggestionListItem[]
}

/** Feedback source with item count. */
export interface FeedbackSourceView {
  id: string
  sourceType: string
  name: string
  enabled: boolean
  itemCount: number
}
