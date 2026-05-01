/**
 * The single switch that distinguishes Quackback Cloud (managed,
 * tier-gated) from Quackback OSS (self-hosted, unlimited).
 *
 * Read from process.env.EDITION. Default and fallback for any
 * unrecognised value is 'oss' — fail closed toward the unrestricted
 * self-hosted experience.
 *
 * This is the ONLY place EDITION is read. Three checkpoints consult
 * IS_CLOUD:
 *   1. tier-limits.service.getTierLimits() — short-circuits to
 *      OSS_TIER_LIMITS without a DB read
 *   2. /api/v1/internal/* endpoints — return 404 outside cloud
 *   3. UI shell (root route context) — hides upgrade chrome
 *
 * Never add a fourth. If something is truly cloud-only, it belongs
 * in the control-plane repo (~/quackback-cp), not in OSS code gated
 * by IS_CLOUD.
 */
const raw = process.env.EDITION
export const EDITION: 'oss' | 'cloud' = raw === 'cloud' ? 'cloud' : 'oss'
export const IS_CLOUD = EDITION === 'cloud'
