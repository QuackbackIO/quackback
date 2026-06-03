/**
 * Shared helpers for parsing PortalAccessGateError values.
 *
 * Lives in lib/shared so it can be imported by both the route error boundary
 * (_portal.tsx) and unit tests without React or router deps.
 */

export interface PortalAccessGateError {
  /** Discriminant — used to identify this error in the route's errorComponent. */
  type: 'portal-access-gate'
  reason: 'unauthenticated' | 'unauthorized'
  workspaceName: string
  logoUrl: string | null
  themeStyles: string
  customCss: string
  /**
   * The signed-in visitor's email when reason === 'unauthorized'. Lets the
   * overlay tell the visitor exactly which account is being blocked so they
   * can sign out and try a different one (typical case: signed in with a
   * personal Gmail when the portal allows @acme.com only). Null/undefined
   * when reason === 'unauthenticated' — no session means no email to show.
   */
  userEmail?: string | null
  authConfig: {
    found: boolean
    oauth: Record<string, boolean | undefined>
    customProviderNames?: Record<string, string>
  }
}

/** Validates all required fields of PortalAccessGateError are present and correct. */
export function isValidGateError(obj: unknown): obj is PortalAccessGateError {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  const userEmail = o['userEmail']
  return (
    o['type'] === 'portal-access-gate' &&
    (o['reason'] === 'unauthenticated' || o['reason'] === 'unauthorized') &&
    typeof o['workspaceName'] === 'string' &&
    (o['logoUrl'] === null || typeof o['logoUrl'] === 'string') &&
    typeof o['themeStyles'] === 'string' &&
    typeof o['customCss'] === 'string' &&
    // userEmail is optional but, when present, must be string or null
    (userEmail === undefined || userEmail === null || typeof userEmail === 'string') &&
    o['authConfig'] !== null &&
    typeof o['authConfig'] === 'object' &&
    typeof (o['authConfig'] as Record<string, unknown>)['found'] === 'boolean' &&
    typeof (o['authConfig'] as Record<string, unknown>)['oauth'] === 'object'
  )
}

/**
 * Extract a PortalAccessGateError from a caught error value.
 *
 * The gate data is carried two ways so it survives SSR serialization:
 *   1. As extra properties on the Error object (works in pure client / dev).
 *   2. As JSON in the error message (survives when only message is preserved).
 */
export function parseGateError(error: unknown): PortalAccessGateError | null {
  if (!(error instanceof Error)) return null
  // Fast path: extra properties survive (dev / client-only execution).
  const ext = error as unknown as Record<string, unknown>
  if (isValidGateError(ext)) return ext as unknown as PortalAccessGateError
  // Fallback: parse from JSON message (SSR serialization strips extra props).
  try {
    const parsed: unknown = JSON.parse(error.message)
    if (isValidGateError(parsed)) return parsed as PortalAccessGateError
  } catch {
    // not a gate error
  }
  return null
}
