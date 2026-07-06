/**
 * Assistant domain: shared retrieval, one-shot answer synthesis, and the
 * in-product AI agent (Quinn) — its workspace identity, involvement record, tool
 * layer, and the TanStack AI runtime seam.
 *
 * Retrieval was built for help-center Ask AI first; the same module backs
 * Quinn's search_knowledge tool. The runtime seam is what the next wave's
 * messenger wiring and the admin sandbox both call.
 */
export {
  retrieveKbArticles,
  KB_ASK_TOP_K,
  KB_ASK_CONTEXT_CHARS,
  RELATED_SIMILARITY_FLOOR,
  type RetrievedKbArticle,
  type RetrieveKbArticlesOptions,
} from './retrieval'

// Source-adapter seam: the composed knowledge-base + (flagged) feedback-posts
// grounding retrieval behind Quinn's search_knowledge tool.
export {
  retrieveKnowledge,
  resolveKnowledgeSources,
  kbKnowledgeSource,
  KNOWLEDGE_TOP_K,
  KNOWLEDGE_SNIPPET_CHARS,
  type RetrievedItem,
  type KnowledgeSource,
} from './retrieval-sources'
export {
  synthesizeAnswer,
  isAskAiConfigured,
  buildAskAiSystemPrompts,
  AskAiNotConfiguredError,
  ASK_AI_MISS_FALLBACK,
  type AskAiAnswer,
  type AskAiAnswerKind,
  type AskAiSource,
  type SynthesizeAnswerParams,
} from './synthesis'

// Quinn — identity
export {
  ensureAssistantPrincipal,
  getAssistantPrincipal,
  ASSISTANT_DEFAULT_NAME,
} from './assistant.principal'

// Quinn — bounded actor
export { quinnActor, ASSISTANT_PERMISSIONS } from './assistant.actor'

// Quinn — involvement record + outcome semantics
export {
  openInvolvement,
  getActiveInvolvement,
  getLatestInvolvement,
  recordAssistantAnswer,
  recordHandoff,
  recordOutcome,
  voidAssumedResolutionForConversation,
  finalizeStaleAssistantInvolvements,
  setInvolvementRating,
  assumedResolutionEligible,
  confirmedResolutionEligible,
  outcomeStatus,
  ASSUMED_RESOLUTION_INACTIVITY_MINUTES,
  type AssistantInvolvement,
  type OutcomeContext,
} from './assistant.involvement'

// Quinn — messenger thread mapping + handover copy
export {
  mapRowsToThreadMessages,
  loadConversationThread,
  ASSISTANT_THREAD_WINDOW,
} from './assistant.thread'
export { buildAssistantHandoverMessage } from './assistant.handover'

// Quinn — tool catalogue
export {
  ASSISTANT_TOOL_SPECS,
  resolveToolSpecs,
  getToolSpecByName,
  searchKnowledgeTool,
  makeAssistantToolContext,
  assistantGateEnvelopeSchema,
  withGateEnvelope,
  SEARCH_BUDGET_PER_TURN,
  type ToolRiskClass,
  type ToolControlMode,
  type AssistantToolSpec,
  type AssistantCitation,
  type AssistantToolContext,
} from './assistant.toolspec'

// Quinn — customization + action plumbing (guidance rules, approval queue,
// tool-call audit); the execution pipeline wires these into the tool assembler.
export {
  createGuidanceRule,
  listGuidanceRules,
  updateGuidanceRule,
  reorderGuidanceRules,
  deleteGuidanceRule,
  GUIDANCE_MAX_ENABLED_PER_SURFACE,
  GUIDANCE_CHAR_BUDGET,
  type AssistantGuidanceRule,
} from './guidance.service'
export {
  proposePendingAction,
  decidePendingAction,
  markPendingActionExecuted,
  markPendingActionFailed,
  expireStalePendingActions,
  type AssistantPendingAction,
} from './pending-actions.service'
export {
  claimToolCall,
  finalizeToolCall,
  recordDeniedToolCall,
  type AssistantToolCall,
} from './tool-audit'

// Quinn — tools + runtime
export { assembleAssistantToolset } from './assistant.tools'
export {
  runAssistantTurn,
  isAssistantConfigured,
  respondEligible,
  assembleCitations,
  decideEscalation,
  isSubstantiveAnswer,
  buildAssistantSystemPrompt,
  AssistantNotConfiguredError,
  ASSISTANT_MAX_ITERATIONS,
  type AssistantTurnInput,
  type AssistantTurnResult,
  type AssistantThreadMessage,
  type AssistantThreadSender,
  type AssistantActivity,
  type EscalationOutcome,
  type EscalationReason,
} from './assistant.runtime'
