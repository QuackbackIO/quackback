/**
 * Per-workspace tier limits. Read by every enforcement seam via
 * getTierLimits(). Default (no row) is OSS_TIER_LIMITS — unlimited
 * everything, all features on. Operators can write a tighter row to
 * cap a workspace; the trusted internal endpoint at
 * /api/v1/internal/tier-limits is the canonical writer.
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
  customColors: boolean
  customCss: boolean
  /** Connecting external tools (GitHub, Slack, Linear, Jira, etc.).
   *  Pro and Scale on cloud; always on for self-hosters. */
  integrations: boolean
}

/**
 * Optional operator-set notice rendered as a banner in the admin UI.
 * Written through the same channel as the limits themselves (the
 * declarative config file / internal writer). Self-hosters can use it
 * for license or maintenance notices; absent (the default) renders
 * nothing.
 */
export interface PlanNotice {
  /** Short badge text, e.g. "Free trial". */
  label: string
  /** Optional supporting copy. */
  message?: string
  /** ISO timestamp; when set the banner renders a countdown. */
  expiresAt?: string
  /** When set the banner renders an action button linking here. */
  actionUrl?: string
  actionLabel?: string
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
  /** See PlanNotice. Absent on OSS defaults. */
  notice?: PlanNotice
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
    customColors: true,
    customCss: true,
    integrations: true,
  },
}
