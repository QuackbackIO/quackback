/**
 * API-key capability scopes. Scope strings are the contract between
 * the OSS endpoints (which check) and any caller (CP, scripts, ops)
 * that mints keys. Add new scopes here so all consumers import the
 * same constant.
 */

/** Allows POST /api/v1/internal/tier-limits and GET /api/v1/internal/usage. */
export const SCOPE_INTERNAL_TIER_LIMITS = 'internal:tier-limits' as const

export type ApiKeyScope = typeof SCOPE_INTERNAL_TIER_LIMITS
