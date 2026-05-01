/**
 * Per-workspace tier limits. Written by the cloud control plane;
 * read by every enforcement seam in OSS code via getTierLimits().
 *
 * Null in any numeric field = unlimited.
 * features.* = true = feature is on.
 *
 * OSS self-hosters keep unlimited behaviour (OSS_TIER_LIMITS).
 */

export type TierLimit<T> = T | null

export interface TierFeatureFlags {
  customDomain: boolean

  customOidcProvider: boolean
  ipAllowlist: boolean

  aiSummaries: boolean
  aiMergeSuggestions: boolean
  aiSentiment: boolean

  webhooks: boolean
  mcpServer: boolean
  analyticsExports: boolean
}

export interface TierLimits {
  maxBoards: TierLimit<number>
  maxPosts: TierLimit<number>
  maxTeamSeats: TierLimit<number>

  aiOpsPerMonth: TierLimit<number>
  apiRequestsPerMonth: TierLimit<number>
  apiRequestsPerMinute: TierLimit<number>

  features: TierFeatureFlags
}

export const OSS_TIER_LIMITS: TierLimits = {
  maxBoards: null,
  maxPosts: null,
  maxTeamSeats: null,

  aiOpsPerMonth: null,
  apiRequestsPerMonth: null,
  apiRequestsPerMinute: null,

  features: {
    customDomain: true,
    customOidcProvider: true,
    ipAllowlist: true,
    aiSummaries: true,
    aiMergeSuggestions: true,
    aiSentiment: true,
    webhooks: true,
    mcpServer: true,
    analyticsExports: true,
  },
}
