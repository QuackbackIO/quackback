/**
 * Which door's `openSignup` answer applies, and how the portal's is resolved.
 *
 * Lives here, free of server imports, because two very different consumers have
 * to agree on it: the server-side gate that refuses an account
 * (`server/auth/signup-policy.ts`) and the sign-in form that has to tell a
 * visitor what will happen. A browser that re-implemented the fallback would
 * drift from the gate, and the drift is invisible: the form would offer a
 * sign-up the server then refuses, or hide one the server would have allowed.
 */

/**
 * Which door the account would come through.
 *
 * `portal` — a member of the public opening an account on the public feedback
 * portal. `team` — somebody joining the workspace's team without an invitation.
 * A workspace answers the two separately and often oppositely.
 */
export type SignupAudience = 'portal' | 'team'

/** The two configs this decision reads, structurally. */
export interface OpenSignupFlags {
  authConfig?: { openSignup?: boolean } | null
  portalConfig?: { openSignup?: boolean } | null
}

/**
 * Has this workspace said the door in question is open?
 *
 * The team's answer is `authConfig.openSignup` and nothing else. The portal's
 * is its own `portalConfig.openSignup` when it has one, and the workspace-wide
 * `authConfig.openSignup` when it does not — an absent portal value is not a
 * "no", it is the shape of a workspace nobody has answered the portal's
 * question for.
 *
 * `??` and not `||`: `false` is an answer, and the fallback exists for the
 * workspace that gave none.
 */
export function signupOpenFor(workspace: OpenSignupFlags, audience: SignupAudience): boolean {
  if (audience === 'team') return workspace.authConfig?.openSignup === true
  return (workspace.portalConfig?.openSignup ?? workspace.authConfig?.openSignup) === true
}
