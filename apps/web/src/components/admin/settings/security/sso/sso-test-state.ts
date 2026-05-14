/**
 * Pure state machine for the SSO test sign-in modal — shared by the
 * standalone "Test sign-in" button and the gate prompts that fire when
 * an admin clicks "Enable" / "Require SSO" without a valid test on
 * record. Kept reducer-pure so the transitions are unit-testable
 * without mocking popups, polling, or postMessage.
 *
 *   closed --open--> prompt --start--> testing --resolved/failed--> result
 *      ^------------------- close (from any phase) -------------------|
 */

import type { HandshakeResult } from '@/lib/server/auth/sso-test-handshake'

/**
 * Wire-shape of a handshake result: the failure branch's `raw?: unknown`
 * debug field is stripped by the callback route before it's written to
 * Redis (TanStack's serializable-input check rejects unknown shapes),
 * so what the modal ever sees is structurally this narrower type.
 */
export type WireResult =
  | Extract<HandshakeResult, { ok: true }>
  | Omit<Extract<HandshakeResult, { ok: false }>, 'raw'>

export type SsoTestPhase = 'closed' | 'prompt' | 'testing' | 'result'

export interface SsoTestState {
  phase: SsoTestPhase
  /** Gate context — why the modal opened. Null for the standalone
   *  "Test sign-in" button; set to a sentence like "Verify sign-in
   *  before enabling SSO." when opened by a gate. */
  reason: string | null
  result: WireResult | null
  error: string | null
  identityMatched: boolean | undefined
  /** Set by `applied` when a gate trigger's auto-apply completed and
   *  asked the modal to stay open with a confirmation (e.g. the Enable
   *  toggle: "Single sign-on is now enabled."). Null otherwise. */
  appliedMessage: string | null
}

export type SsoTestAction =
  | { type: 'open'; reason?: string }
  | { type: 'start' }
  | { type: 'resolved'; result: WireResult; identityMatched: boolean | undefined }
  | { type: 'applied'; message: string }
  | { type: 'failed'; error: string }
  | { type: 'close' }

export const initialSsoTestState: SsoTestState = {
  phase: 'closed',
  reason: null,
  result: null,
  error: null,
  identityMatched: undefined,
  appliedMessage: null,
}

export function ssoTestReducer(state: SsoTestState, action: SsoTestAction): SsoTestState {
  switch (action.type) {
    case 'open':
      // Always re-enter `prompt` from a clean slate — a re-open after a
      // prior result shouldn't flash the stale diagnostic.
      return {
        ...initialSsoTestState,
        phase: 'prompt',
        reason: action.reason ?? null,
      }
    case 'start':
      // Keep `reason` so the result view can still show gate context;
      // clear any stale result/error from a previous attempt.
      return {
        ...state,
        phase: 'testing',
        result: null,
        error: null,
        identityMatched: undefined,
        appliedMessage: null,
      }
    case 'resolved':
      return {
        ...state,
        phase: 'result',
        result: action.result,
        error: null,
        identityMatched: action.identityMatched,
      }
    case 'applied':
      // The gate trigger applied its action and wants the modal to stay
      // open on the result view with a confirmation banner.
      return { ...state, appliedMessage: action.message }
    case 'failed':
      return {
        ...state,
        phase: 'result',
        result: null,
        error: action.error,
        identityMatched: undefined,
      }
    case 'close':
      return initialSsoTestState
    default:
      return state
  }
}
