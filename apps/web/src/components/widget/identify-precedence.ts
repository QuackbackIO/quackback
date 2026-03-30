/**
 * Determines what action the widget should take for an incoming identify call.
 *
 * Precedence rules:
 * - `clear` (null): always clears, regardless of context
 * - `identify` (named user): always runs — explicit SDK override
 * - `anonymous`: runs ONLY when no portal session exists. On the portal,
 *   the portal session (fetched via cookie) takes precedence over anonymous
 *   SDK identify to prevent downgrading an authenticated user.
 */

export type IdentifyAction = 'identify' | 'anonymous' | 'clear' | 'skip'

export type SessionSource = 'portal' | 'sdk' | null

interface ResolveParams {
  /** The identify data from the SDK postMessage */
  identifyData: { anonymous?: boolean; id?: string; email?: string } | null
  /** Whether a portal session exists (same-origin context) */
  hasPortalSession: boolean
  /** Where the current widget session originated from */
  sessionSource: SessionSource
}

export function resolveIdentifyAction(params: ResolveParams): IdentifyAction {
  const { identifyData, hasPortalSession } = params

  // null → always clear
  if (identifyData === null) {
    return 'clear'
  }

  // Named identify (has id or ssoToken) → always run
  if (identifyData.anonymous !== true) {
    return 'identify'
  }

  // Anonymous identify — skip if portal session exists
  if (hasPortalSession) {
    return 'skip'
  }

  return 'anonymous'
}
