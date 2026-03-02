/**
 * Feedback domain types.
 *
 * Types for the feedback aggregation pipeline: ingestion, extraction,
 * interpretation, and suggestions.
 */

// Re-export JSONB column types for convenience
export type {
  RawFeedbackAuthor,
  RawFeedbackContent,
  RawFeedbackThreadMessage,
  RawFeedbackItemContextEnvelope,
} from '@/lib/server/db'

// ============================================
// Processing State Enums
// ============================================

export type RawFeedbackProcessingState =
  | 'pending_context'
  | 'ready_for_extraction'
  | 'extracting'
  | 'interpreting'
  | 'completed'
  | 'failed'

export type SignalProcessingState =
  | 'pending_interpretation'
  | 'interpreting'
  | 'completed'
  | 'failed'

export type SuggestionType = 'create_post'
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed' | 'expired'

export type SignalType =
  | 'feature_request'
  | 'bug_report'
  | 'usability_issue'
  | 'question'
  | 'praise'
  | 'complaint'
  | 'churn_risk'

export type Sentiment = 'positive' | 'neutral' | 'negative'
export type Urgency = 'critical' | 'high' | 'medium' | 'low'

// ============================================
// AI Pipeline Output Types
// ============================================

export interface ExtractionResult {
  signals: Array<{
    signalType: SignalType
    summary: string
    implicitNeed?: string
    evidence: string[]
    confidence: number
  }>
}

/** Result from LLM for generating a suggested post title/body from a signal. */
export interface SuggestionGenerationResult {
  title: string
  body: string
  boardId: string | null
  reasoning: string
}

// ============================================
// Queue Job Types
// ============================================

export type FeedbackIngestJob =
  | { type: 'enrich-context'; rawItemId: string }
  | { type: 'poll-source'; sourceId: string; cursor?: string }
  | { type: 'parse-batch'; sourceId: string; importId: string }

export type FeedbackAiJob =
  | { type: 'extract-signals'; rawItemId: string }
  | { type: 'interpret-signal'; signalId: string }

export type FeedbackMaintenanceJob =
  | { type: 'recover-stuck-items' }
  | { type: 'expire-stale-suggestions' }

// ============================================
// Raw Feedback Seed (input to ingestion)
// ============================================

export type { RawFeedbackSeed } from '../../integrations/feedback-source-types'
