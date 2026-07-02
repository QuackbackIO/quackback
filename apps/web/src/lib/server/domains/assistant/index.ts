/**
 * Assistant domain: shared retrieval + answer synthesis.
 *
 * Home of the audience-scoped knowledge retrieval module and the model
 * synthesis seam. Built for help-center Ask AI first; the same retrieval
 * function backs the assistant's future knowledge tools.
 */
export {
  retrieveKbArticles,
  KB_ASK_TOP_K,
  KB_ASK_CONTEXT_CHARS,
  type RetrievedKbArticle,
  type RetrieveKbArticlesOptions,
} from './retrieval'
export {
  synthesizeAnswer,
  isAskAiConfigured,
  buildAskAiSystemPrompts,
  AskAiNotConfiguredError,
  type AskAiAnswer,
  type AskAiSource,
  type SynthesizeAnswerParams,
} from './synthesis'
