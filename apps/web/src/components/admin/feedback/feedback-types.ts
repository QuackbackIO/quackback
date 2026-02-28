/**
 * View types for feedback components.
 *
 * These represent the shapes returned by the feedback server functions
 * and consumed by the UI components.
 */

import type { RawFeedbackAuthor, RawFeedbackContent } from '@/lib/server/db'

// ============================================
// Suggestion Types
// ============================================

/** Suggestion in list view - returned by fetchSuggestions. */
export interface SuggestionListItem {
  id: string
  suggestionType: 'merge_post' | 'create_post'
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
    source: {
      id: string
      name: string
      sourceType: string
    } | null
  } | null
  targetPost: {
    id: string
    title: string
    voteCount: number
    status: string
  } | null
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

/** Full suggestion detail - returned by fetchSuggestionDetail. */
export interface SuggestionDetailView extends SuggestionListItem {
  resultPost: {
    id: string
    title: string
  } | null
  signal: {
    id: string
    signalType: string
    summary: string
    evidence: string[]
    implicitNeed: string | null
    extractionConfidence: number
  } | null
}

/** Feedback source with item count. */
export interface FeedbackSourceView {
  id: string
  sourceType: string
  name: string
  enabled: boolean
  itemCount: number
}

// ============================================
// Pipeline Stats
// ============================================

/** Pipeline stats returned by fetchFeedbackPipelineStats. */
export interface PipelineStats {
  rawItems: Record<string, number>
  signals: Record<string, number>
  pendingSuggestions: number
}
