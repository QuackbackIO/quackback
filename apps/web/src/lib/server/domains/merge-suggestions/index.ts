export { findMergeCandidates, type MergeCandidate } from './merge-search.service'
export { assessMergeCandidates, determineDirection } from './merge-assessment.service'
export {
  createMergeSuggestion,
  acceptMergeSuggestion,
  dismissMergeSuggestion,
  getPendingSuggestionsForPost,
  expireStaleMergeSuggestions,
  type MergeSuggestionView,
} from './merge-suggestion.service'
export { checkPostForMergeCandidates, sweepMergeSuggestions } from './merge-check.service'
