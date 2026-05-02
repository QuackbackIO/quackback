/**
 * Per-workspace tier limits. Read by every enforcement seam in OSS code
 * via getTierLimits(). Default (no row) is OSS_TIER_LIMITS — unlimited
 * everything, all features on.
 *
 * Null in any numeric field = unlimited.
 * features.* = true = feature is on.
 */

export type TierLimit<T> = T | null

export interface TierFeatureFlags {
  customDomain: boolean
  customOidcProvider: boolean
  ipAllowlist: boolean
  webhooks: boolean
  mcpServer: boolean
  analyticsExports: boolean
}

export interface TierLimits {
  maxBoards: TierLimit<number>
  maxPosts: TierLimit<number>
  maxTeamSeats: TierLimit<number>

  /**
   * Monthly LLM token budget (input + output combined). All AI features
   * (summaries, merge suggestions, sentiment, future ones) draw from
   * this single budget. 0 blocks AI entirely; null = unlimited.
   * Embeddings are excluded (they're tracked but not billed).
   */
  aiTokensPerMonth: TierLimit<number>

  apiRequestsPerMonth: TierLimit<number>
  apiRequestsPerMinute: TierLimit<number>

  features: TierFeatureFlags
}

export const OSS_TIER_LIMITS: TierLimits = {
  maxBoards: null,
  maxPosts: null,
  maxTeamSeats: null,

  aiTokensPerMonth: null,

  apiRequestsPerMonth: null,
  apiRequestsPerMinute: null,

  features: {
    customDomain: true,
    customOidcProvider: true,
    ipAllowlist: true,
    webhooks: true,
    mcpServer: true,
    analyticsExports: true,
  },
}
