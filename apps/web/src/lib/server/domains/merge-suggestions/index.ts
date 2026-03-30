/**
 * Merge Suggestions module - Types Only
 *
 * Import service functions directly:
 *   - './merge-search.service' for findMergeCandidates
 *   - './merge-assessment.service' for assessMergeCandidates
 *   - './merge-suggestion.service' for CRUD
 *   - './merge-check.service' for background checks
 */
export type { MergeCandidate } from './merge-search.service'
export type { MergeSuggestionView } from './merge-suggestion.service'
