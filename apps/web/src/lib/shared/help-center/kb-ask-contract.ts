/**
 * Shared kb-ask payload shapes, used by the server route (emit) and the Ask AI
 * client (consume) over TanStack AI's AG-UI wire. Client-safe: types only.
 *
 * The pre-synthesis source metadata rides AG-UI's standard STATE_SNAPSHOT
 * event (`{ snapshot: KbAskStateSnapshot }`); the validated answer rides the
 * standard RUN_FINISHED.result slot (`KbAskFinalPayload`); a terminal failure
 * rides RUN_ERROR `{ code, message }`. These payloads ship with our own
 * bundles in lockstep, so their shapes can evolve without a wire version.
 */

/** Display metadata for one retrieved article, sent before synthesis starts. */
export interface KbAskSourceMeta {
  articleId: string
  title: string
  slug: string
  categorySlug: string
  categoryName: string
}

/**
 * STATE_SNAPSHOT.snapshot: the articles the answer will be built from, shipped
 * before synthesis so the surface can resolve the citation-dot display join
 * while the answer streams.
 */
export interface KbAskStateSnapshot {
  sources: KbAskSourceMeta[]
}

/**
 * Whether the final answer is grounded in cited articles, or an ungrounded
 * graceful "couldn't find that" reply. A miss still carries prose (the model's
 * contextual acknowledgement), so `answer` is null only on a hard failure.
 */
export type KbAskAnswerKind = 'grounded' | 'no_answer'

/** RUN_FINISHED.result: the validated answer. */
export interface KbAskFinalPayload {
  /** 'grounded' cites articles; 'no_answer' is a graceful, uncited miss. */
  kind: KbAskAnswerKind
  /** Answer or miss prose. Null only when the model could not be reached. */
  answer: string | null
  /** Cited articles for a grounded answer, ordered to match inline [n]. */
  sources: Array<{ articleId: string }>
  /** Related near-miss articles to suggest as next steps on a no_answer. */
  related?: KbAskSourceMeta[]
}
