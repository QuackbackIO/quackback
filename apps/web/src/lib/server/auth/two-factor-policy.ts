/**
 * Pure predicate deciding whether a password sign-in attempt should
 * be redirected to `/auth/two-factor-setup-required`.
 *
 * Three inputs, no DB / no network — kept side-effect-free so the
 * `hooksBefore` gate can stay readable and the rule is exhaustively
 * testable. The caller (the gate) is responsible for resolving each
 * field from the live request:
 *   - `role` — from `principal.role` looked up by email
 *   - `userHas2FA` — `user.twoFactorEnabled === true`
 *   - `workspaceRequired` — `authConfig.twoFactor?.required === true`
 *
 * Policy:
 *   - Toggle off            → false (open, today's behaviour)
 *   - Portal user (role)    → false (only team roles are gated)
 *   - Team role + enrolled  → false (2FA challenge happens elsewhere)
 *   - Team role + missing   → true  (block; redirect to setup landing)
 */
export function shouldRequire2FA(input: {
  role: 'admin' | 'member' | 'user'
  userHas2FA: boolean
  workspaceRequired: boolean
}): boolean {
  if (!input.workspaceRequired) return false
  if (input.role === 'user') return false
  return !input.userHas2FA
}

/**
 * Outcome for a magic-link sign-in attempt under the workspace 2FA
 * policy.
 *
 *  - `allow`           — Sign-in proceeds normally.
 *  - `setup-required`  — Team user with no 2FA enrolled; same redirect
 *                        as the password gate (`/auth/two-factor-setup-
 *                        required`).
 *  - `use-password`    — Team user WITH 2FA enrolled tried magic-link.
 *                        Better-Auth's twoFactor plugin only intercepts
 *                        password paths, so the magic-link flow would
 *                        otherwise hand them an authenticated session
 *                        without their second factor. Refuse and steer
 *                        them to the password flow where the plugin
 *                        handles the TOTP challenge correctly. Recovery
 *                        codes remain the break-glass for lost TOTP.
 */
export type MagicLinkTwoFactorOutcome = 'allow' | 'setup-required' | 'use-password'

/**
 * Pure predicate deciding what happens when a magic-link verification
 * succeeds for a team-role user under workspace-required 2FA. Same
 * inputs as `shouldRequire2FA`; richer output to disambiguate the
 * "user has 2FA but used the wrong sign-in path" case from the "user
 * never enrolled" case.
 *
 * Portal users (`role='user'`) are never gated — workspace 2FA is a
 * team-side policy.
 */
export function evaluateMagicLinkTwoFactor(input: {
  role: 'admin' | 'member' | 'user'
  userHas2FA: boolean
  workspaceRequired: boolean
}): MagicLinkTwoFactorOutcome {
  if (!input.workspaceRequired) return 'allow'
  if (input.role === 'user') return 'allow'
  return input.userHas2FA ? 'use-password' : 'setup-required'
}
