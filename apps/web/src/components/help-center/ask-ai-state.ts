/**
 * Ask AI answer state: owned by useAskAi (ask-ai.tsx) and filled in by the
 * streaming run it loads on demand (ask-ai-run.ts).
 */
import type { KbAskAnswerKind, KbAskSourceMeta } from '@/lib/shared/help-center/kb-ask-contract'

export type AskAiSourceMeta = KbAskSourceMeta

export type AskAiStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'no-answer' | 'error'

export interface AskAiState {
  status: AskAiStatus
  question: string
  answer: string
  /** 'grounded' cites sources; 'no_answer' offers related suggestions. */
  kind: KbAskAnswerKind
  /** Sources cited by a grounded answer, resolved to display metadata. */
  citedSources: AskAiSourceMeta[]
  /** Related near-miss articles suggested on a no_answer. */
  related: AskAiSourceMeta[]
}

export const IDLE_STATE: AskAiState = blankAskAiState('', 'idle')

/**
 * A result-less state (loading, error, hard no-answer): the answer/source
 * fields are all empty and unread until a terminal event replaces them.
 */
export function blankAskAiState(question: string, status: AskAiStatus): AskAiState {
  return { status, question, answer: '', kind: 'grounded', citedSources: [], related: [] }
}
