/**
 * `openSignup`, enforced.
 *
 * The setting has always been written on every workspace and read by nothing on
 * any server-side auth path: only the browser consulted it, and only to decide
 * which form to draw. A setting that is written everywhere, believed, and
 * enforced nowhere is worse than no setting at all, so this is the one place
 * that answers the question every account-creating path has to ask first.
 *
 * ## The question
 *
 * Not "is this method enabled" — that is `isAuthMethodAllowed`, a different
 * concern that a workspace can satisfy while still refusing strangers. This one
 * is: **would honouring this request bring a new account into existence on THIS
 * DOOR, and may it?**
 *
 * | Fact | Answer | Why |
 * | --- | --- | --- |
 * | no `settings` row | allowed | A workspace nobody has set up yet. The self-hosted first run creates its account before it creates its settings, so refusing here would brick the product's normal install |
 * | the door's own `openSignup` is true | allowed | The workspace says so, about that door — see {@link SignupAudience} |
 * | the address is at a domain the portal grants access to | allowed | An admin listed that domain. Same authority as an invitation, written as configuration instead of a row |
 * | a `user` row holds this address | allowed | This is a sign-in, not a sign-up, whatever endpoint it arrived on |
 * | a pending invitation names this address | allowed | Somebody with authority here already said yes to this person. Team and portal invites both count: each is an explicit grant, recorded as a row rather than inferred from a request |
 * | nobody owns setup, and arriving here is still a way to take it | allowed | See below |
 * | otherwise | refused | |
 *
 * Every exemption is a fact in the database, never a flag on the request. A
 * request-scoped "this one is fine" marker is exactly how an internal path and
 * an attacker-reachable one end up sharing a bypass.
 *
 * ## There are two doors and they hold two different answers
 *
 * `authConfig` is the TEAM's configuration — "Controls how team members
 * (admin/member roles) can sign in" — and `authConfig.openSignup` is the team's
 * answer: may somebody join the team without an invitation? `portalConfig` is
 * the public portal's, and `portalConfig.openSignup` is the portal's: may a
 * member of the public open an account to leave feedback?
 *
 * They are routinely opposite, and on purpose. Every provisioned workspace is
 * seeded with `authConfig.openSignup: false` and `portalConfig.openSignup: true`
 * in the same breath — anyone may sign up to leave feedback, and the team is
 * invitation-only. A gate that asks one flag for both doors does not enforce
 * that pair, it discards half of it: reading the team's answer at the portal
 * closes the public portal of every such workspace, and reading the portal's at
 * the team would open the team on every workspace that welcomes feedback. So
 * the audience is an argument, with no default — a caller that has not decided
 * which door it is cannot be given one silently.
 *
 * The portal falls back to `authConfig.openSignup` when it has no answer of its
 * own, which is the self-hosted shape: one toggle in one settings page, no
 * portal-specific value ever written, and an admin who closes sign-ups there
 * means the portal too. See {@link signupOpenFor}.
 *
 * That fallback has a sharp edge worth stating: a workspace whose team answer
 * was written FOR it and whose portal answer was not reads as closed, and it is
 * indistinguishable here from an admin who closed both. The two seeds are
 * separate best-effort writes that each land only on a null column, so the
 * combination is reachable, and no amount of care in this file can tell those
 * two workspaces apart — only the writer that left one column behind can go
 * back and finish the pair.
 *
 * ## `openSignup` is only ever an answer somebody gave
 *
 * `DEFAULT_AUTH_CONFIG.openSignup` is the value a workspace that never
 * configured one reports, and it is `true` for a reason that is easy to get
 * backwards. Before this file existed the setting bound nothing on the server,
 * so **every** workspace behaved as open regardless of what it reported;
 * enforcing a value nobody chose would not have been enforcing a policy, it
 * would have been inventing one and applying it retroactively to the whole
 * installed base. The cohort that would have been hit hardest is the one that
 * never touches the wizard: `config-file/deps.ts::createSettings` inserts a
 * `settings` row with no `authConfig` at all, so a control-plane-provisioned
 * workspace's portal would have closed to the public the moment its owner
 * arrived, without anybody choosing that. A workspace that means it says so,
 * and `false` is then honoured everywhere.
 *
 * ## Why an unowned install is exempt
 *
 * `openSignup` is an admin's statement, and before a workspace has an admin
 * nobody has made it — the stored value there is whatever a declarative config
 * file left behind. Refusing on it would refuse the install's own first user
 * and leave a workspace nobody can ever set up, the same defect that once made
 * a pre-stamped workspace refuse its first user, arriving from the other
 * direction.
 *
 * So the exemption is exactly the case where somebody still has to become the
 * admin AND arriving is still how that happens: `findHumanAdmin` and
 * `isOpenToBootstrapClaim`, the same two facts the promoters themselves decide
 * on. That is what keeps this gate and the bootstrap guards from disagreeing —
 * a workspace where one lets you in and the other refuses to promote you is a
 * dead end, and a workspace where one refuses and the other would promote is
 * the hole. On a provisioned workspace the second fact is false, so an unowned
 * one stays closed: its owner is recorded where it was created.
 *
 * ## Where it is asked, and which door each caller is
 *
 * All three of today's callers ask the PORTAL question, for one shared reason:
 * `auth/index.ts`'s `databaseHooks.user.create.after` mints every brand-new
 * account's principal with `role: 'user'`, unconditionally. An account created
 * by any of these paths IS a portal account; nothing they can be handed makes
 * one a team member. Team membership is conferred afterwards and elsewhere — by
 * accepting an invitation, by the bootstrap claim, or by an IdP the admin
 * configured to auto-provision — and the first two are already exemptions
 * below, so asking the portal's question here gives the team's answer nothing
 * to lose.
 *
 * - `hooks.ts` Layer B, for the email-bearing endpoints that can create an
 *   account, so a refusal costs nothing and carries a real error code. Nothing
 *   in a request at that point names an audience: the four gated paths are each
 *   reachable from the portal dialog and the team login alike, and the only
 *   field that would hint — `callbackURL` — is absent from every first-party
 *   caller of them and is supplied by whoever is asking, which makes it a flag
 *   on the request rather than a fact in the database. So the audience is
 *   settled by what the creation produces, not by what the request claims.
 * - `email-signin.ts`, before `mintMagicLinkUrl`. That mint deliberately does
 *   not run the `hooks.before` chain, and it writes its verification row in
 *   parallel with the OTP send — so a Layer B refusal on the OTP half would
 *   still leave a working sign-in link minted. The gate has to be in front of
 *   the mint, not around it. Its `callbackURL` may point at `/admin`, and that
 *   still does not make it the team door: the account it would create is a
 *   portal one, and the team surface refuses it on arrival for want of a role.
 * - `auth/index.ts`'s `databaseHooks.user.create.before`, as the backstop that
 *   does not depend on anyone having enumerated the paths correctly. Every
 *   account Better-Auth creates — password, magic link, one-time code, social,
 *   OIDC — funnels through that hook, and every one of them lands as a portal
 *   account.
 *
 * ## What a refusal is allowed to say
 *
 * The answer is a function of the ADDRESS, not of the workspace, so a caller
 * who can see it learns whether that address holds an account here or has been
 * invited and not yet joined. `email-signin.ts` therefore never reports it back
 * to its caller: the whole refusal is delivered to the address itself. Layer B
 * does redirect with `signup_not_allowed`, which is that same differential on
 * four Better-Auth endpoints, and it is bounded rather than closed — those
 * endpoints sit behind `checkMagicLinkSendRateLimit`, which is spent before the
 * question is asked.
 *
 * Anonymous widget sessions are exempt at the backstop rather than here: their
 * synthetic placeholder address is not a signup in any sense a workspace admin
 * means by the word.
 *
 * Accounts an admin creates directly (portal user admin, import, verified
 * widget identify) never reach any of these paths; they are authenticated acts
 * by someone who already holds the workspace, and `openSignup` does not speak
 * about them.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signup-policy' })

/**
 * The `?error=` code a blocked self-service signup lands with. Listed in
 * `auth-block-messages.ts` so the auth client renders it rather than the
 * generic fallback.
 */
export const SIGNUP_NOT_ALLOWED = 'signup_not_allowed'

/**
 * Which door the account would come through.
 *
 * `portal` — a member of the public opening an account on the public feedback
 * portal. `team` — somebody joining the workspace's team without an invitation.
 * A workspace answers the two separately and often oppositely; see the module
 * header for why this is an argument rather than a lookup.
 */
export type SignupAudience = 'portal' | 'team'

/** The two configs this decision reads, structurally. */
interface OpenSignupFlags {
  authConfig?: { openSignup?: boolean }
  portalConfig?: { openSignup?: boolean }
}

/**
 * Has this workspace said the door in question is open?
 *
 * The team's answer is `authConfig.openSignup` and nothing else. The portal's
 * is its own `portalConfig.openSignup` when it has one, and the workspace-wide
 * `authConfig.openSignup` when it does not — an absent portal value is not a
 * "no", it is the shape of a workspace whose admin only ever saw one toggle.
 *
 * `??` and not `||`: `false` is an answer, and the fallback exists for the
 * workspace that gave none.
 */
function signupOpenFor(workspace: OpenSignupFlags, audience: SignupAudience): boolean {
  if (audience === 'team') return workspace.authConfig?.openSignup === true
  return (workspace.portalConfig?.openSignup ?? workspace.authConfig?.openSignup) === true
}

/**
 * Would creating an account for `email` be allowed on this workspace right now,
 * on the door `audience` names?
 *
 * `email` is normalised here rather than trusted: the callers reach this from
 * three different endpoints with three different amounts of trimming, and a
 * lookup that misses on case is an exemption that silently stops applying.
 *
 * `audience` has no default on purpose. The whole defect this argument exists
 * to prevent was one question answered off one flag for two doors, and a
 * default is how a new caller inherits the wrong one without saying so.
 */
export async function isAccountCreationAllowed(
  email: string,
  audience: SignupAudience
): Promise<boolean> {
  const normalised = email.trim().toLowerCase()
  if (normalised === '') return false

  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const workspace = await getWorkspaceSettings()

  // No settings row at all: an install that has not been set up yet. Its very
  // first account is created before the row exists.
  if (!workspace) return true
  if (signupOpenFor(workspace, audience)) return true

  // An admin listed this domain as one whose people get portal access. That is
  // the same authority the invitation exemption rests on — somebody who holds
  // the workspace already said yes to these people — and without it the grant
  // is unreachable: `portal-access.ts` requires a verified account before it
  // will honour a domain, and this gate is what stands between the person and
  // the account the grant is about. Free: the list is already in hand.
  //
  // Not conditioned on the portal being private. The list is an explicit
  // statement about a domain either way, and making the exemption depend on a
  // second setting means flipping that setting silently withdraws it.
  const domain = normalised.split('@')[1] ?? null
  const allowedDomains = workspace.portalConfig?.access?.allowedDomains ?? []
  if (domain && allowedDomains.some((d) => d.trim().toLowerCase() === domain)) return true

  const { db, user, invitation, and, eq, gt, inArray, sql } = await import('@/lib/server/db')

  // Exact match, on the same normalisation `handleSignInPreCheck` uses for its
  // own user lookup: Better-Auth lowercases an address before it stores one, so
  // these two must agree or the gate and the pre-check would disagree about
  // whether an account exists.
  const existing = await db.query.user.findFirst({
    where: eq(user.email, normalised),
    columns: { id: true },
  })
  if (existing) return true

  // Case-folded, because the invite paths themselves compare that way
  // (`inv.email.toLowerCase() !== sessionEmail`) — so a team invite can hold a
  // mixed-case address, and an exemption that missed on case would refuse the
  // very person an admin invited.
  //
  // `kind` is filtered explicitly, as the schema requires of every query
  // against this table. Both kinds are genuine grants and both exempt, so the
  // filter changes nothing today; it is written as a closed list so that a
  // third kind added later is refused until somebody decides it should not be.
  const invited = await db.query.invitation.findFirst({
    where: and(
      sql`lower(${invitation.email}) = ${normalised}`,
      inArray(invitation.kind, ['team', 'portal']),
      eq(invitation.status, 'pending'),
      gt(invitation.expiresAt, new Date())
    ),
    columns: { id: true },
  })
  if (invited) return true

  // Last, because it is the only branch that costs two more reads, and it is
  // reached only on the path that is about to refuse.
  const { findHumanAdmin, isOpenToBootstrapClaim } =
    await import('@/lib/server/domains/principals/bootstrap-admin')
  const [owner, openToClaim] = await Promise.all([findHumanAdmin(db), isOpenToBootstrapClaim(db)])
  if (!owner && openToClaim) return true

  // Domain only. The address is the thing an operator must never be able to
  // read back out of a log, and the domain is enough to tell a misconfigured
  // workspace from a stranger knocking. The audience rides along because the
  // two doors refuse for different reasons and a refusal nobody can attribute
  // to one of them is a support ticket nobody can answer.
  log.info({ email_domain: domain, audience }, 'account creation refused')
  return false
}

/**
 * The backstop, wired as Better-Auth's `databaseHooks.user.create.before`.
 *
 * Lives here rather than inline at the wiring site so the decision can be
 * driven directly by a test: an inline body inside the options object passed to
 * `betterAuth()` is only reachable by standing up a whole auth instance, and a
 * gate nobody can exercise is a gate nobody has checked.
 *
 * ## Two ways to refuse, and why both are needed
 *
 * Returning `false` is Better-Auth's own abort signal — `createWithHooks`
 * returns null. Most creating paths handle that null with a redirect (the
 * magic-link verify with `failed_to_create_user`, the OAuth callback with
 * `unable_to_create_user`), which is the right shape in front of a browser
 * mid-navigation, and throwing there would put a raw error page in its place.
 *
 * The one-time-code redemption does not handle it. Better-Auth 1.6.16's
 * `plugins/email-otp/routes.mjs` consumes the code, calls `createUser`, and
 * dereferences the result without a null check — so a `false` there is a raw
 * 500 with the code already spent, and the person cannot even retry. That path
 * gets a thrown `APIError` instead: an XHR caller renders its message, and
 * being told why is strictly better than a 500 either way.
 *
 * The trigger is narrow — Layer B already refused before the code was sent, so
 * reaching here means the answer changed in between (an invitation expired, an
 * admin closed sign-ups) — but "narrow" is not "handled".
 *
 * ## The anonymous exemption
 *
 * The anonymous plugin needs a unique non-null email and mints a synthetic
 * placeholder for one, which is not a person signing up in any sense a
 * workspace admin means by the word. Blocking them would take the widget down
 * on every workspace that closed sign-ups.
 *
 * ## Why the portal door, on every path
 *
 * This hook sits immediately before the `after` half that creates the
 * principal, and that half writes `role: 'user'` for every account without
 * consulting anything. So whatever endpoint asked — password, magic link,
 * one-time code, social, OIDC — what is about to exist is a portal account, and
 * the portal's answer is the one that governs it.
 */
export async function guardBetterAuthUserCreation(
  user: { email?: unknown },
  ctx?: { path?: string } | null
): Promise<false | undefined> {
  const email = typeof user.email === 'string' ? user.email : ''
  const { isSyntheticAnonEmail } = await import('@/lib/shared/anonymous-email')
  if (isSyntheticAnonEmail(email)) return undefined
  if (await isAccountCreationAllowed(email, 'portal')) return undefined
  log.warn(
    { email_domain: email.split('@')[1] ?? null },
    'account creation blocked: workspace is not accepting new accounts'
  )
  if (ctx?.path && PATHS_THAT_DEREFERENCE_THE_ABORT.has(ctx.path)) {
    const { APIError } = await import('better-auth/api')
    const { AUTH_BLOCK_MESSAGES } = await import('@/lib/shared/auth-block-messages')
    throw new APIError('FORBIDDEN', {
      code: SIGNUP_NOT_ALLOWED,
      message: AUTH_BLOCK_MESSAGES[SIGNUP_NOT_ALLOWED],
    })
  }
  return false
}

/**
 * Better-Auth endpoints that call `createUser` and then use the result without
 * checking it for null. Aborting with `false` on one of these is a raw 500, so
 * they are refused by throwing instead.
 *
 * Verified against the installed 1.6.16 source. Keep it a list of paths that
 * genuinely lack the check rather than a list of paths that happen to be XHR:
 * the reason to throw is the missing null check, not the caller's shape.
 */
const PATHS_THAT_DEREFERENCE_THE_ABORT = new Set<string>(['/sign-in/email-otp'])
