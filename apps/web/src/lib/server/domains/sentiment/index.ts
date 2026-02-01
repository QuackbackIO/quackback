/**
 * Sentiment analysis module exports
 *
 * IMPORTANT: This barrel export includes both types and service functions.
 * Service functions access the database and should only be imported in
 * server-only code (server functions, API routes, hooks handlers, etc.)
 *
 * For client-safe code, import only the types:
 * import type { Sentiment, SentimentResult } from '@/lib/server/domains/sentiment'
 */

// Types
export type {
  Sentiment,
  SentimentResult,
  SentimentBreakdown,
  SentimentTrendPoint,
  PostForSentiment,
} from './sentiment.service'

// Service functions (server-only)
export {
  analyzeSentiment,
  saveSentiment,
  getSentiment,
  getSentimentBreakdown,
  getSentimentTrend,
  getPostsWithoutSentiment,
} from './sentiment.service'
