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
 * own. That is the ordinary shape for a workspace nobody has answered the
 * question for: the onboarding wizard writes the workspace-wide key and no
 * portal-specific one, so until an administrator uses the portal's own signup
 * toggle there is a single answer and the portal obeys it. See
 * {@link signupOpenFor}.
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
 * arrived, without anybody choosing that.
 *
 * A workspace that means "invitation only" says so through the portal's own
 * answer, which is the one an administrator has a control for, and `false` is
 * honoured wherever either key stores it.
 *
 * ## Why an unowned install is exempt
 *
 * `openSignup` is an admin's statement, and before a workspace has an admin
 * nobody has made it: nothing writes either key except the onboarding wizard,
 * which has not run, and the portal signup toggle, which nobody has reached
 * without an account. Refusing on it would refuse the install's own first user
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
 * configured to auto-provision — and all three are exemptions rather than
 * answers to this question, so asking the portal's question here gives the
 * team's answer nothing to lose. The first two are exemptions inside
 * {@link isAccountCreationAllowed}; the third is
 * {@link isSsoAutoProvisionGrant}, checked at the backstop because the IdP's
 * callback is the only place it is knowable.
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
 *   OIDC — funnels through that hook. All but one land as a portal account; the
 *   exception is an identity provider's own callback, which the hook exempts
 *   before it asks the portal anything.
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
import { signupOpenFor, type SignupAudience } from '@/lib/shared/signup-open'

const log = logger.child({ component: 'signup-policy' })

/**
 * The `?error=` code a blocked self-service signup lands with. Listed in
 * `auth-block-messages.ts` so the auth client renders it rather than the
 * generic fallback.
 */
export const SIGNUP_NOT_ALLOWED = 'signup_not_allowed'

/**
 * The audience and the resolution rule live in `@/lib/shared/signup-open`, not
 * here: the sign-in form has to reach the same answer this gate does, and a
 * second implementation of the fallback in the browser would drift silently.
 * Re-exported so callers of the policy still see one module.
 */
export type { SignupAudience } from '@/lib/shared/signup-open'

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
 * ## The portal door, on every path but one
 *
 * This hook sits immediately before the `after` half that creates the
 * principal, and that half writes `role: 'user'` for every account without
 * consulting anything. So whatever endpoint asked — password, magic link,
 * one-time code, social — what is about to exist is a portal account, and the
 * portal's answer is the one that governs it.
 *
 * The exception is an identity provider's own callback, where the account is
 * not a stranger walking up to the portal but the provisioning an administrator
 * configured. See {@link isSsoAutoProvisionGrant}.
 */
export async function guardBetterAuthUserCreation(
  user: { email?: unknown },
  ctx?: { path?: string; params?: Record<string, unknown> } | null
): Promise<false | undefined> {
  const email = typeof user.email === 'string' ? user.email : ''
  const { isSyntheticAnonEmail } = await import('@/lib/shared/anonymous-email')
  if (isSyntheticAnonEmail(email)) return undefined
  if (await isSsoAutoProvisionGrant(email, ctx)) return undefined
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

/**
 * The generic-OAuth callback template. `ctx.path` at a database hook is the
 * ROUTED endpoint's template, not a value anyone sent, so matching on it says
 * "a provider's token exchange completed" rather than "somebody claimed it
 * did". `ctx.params.providerId` is filled in by the router from the URL it
 * matched, which is why this is the one place the policy may look at a request
 * at all.
 */
const OIDC_CALLBACK_PATH = '/oauth2/callback/:providerId'

/**
 * Is this account creation the just-in-time provisioning an administrator
 * configured, rather than a stranger opening a portal account?
 *
 * `openSignup` is a statement about self-service: whether somebody the
 * workspace has never heard of may bring an account into existence by asking.
 * An identity provider's callback is not that. The address arrived attested by
 * an IdP an administrator chose, at a domain that IdP proved it owns, on a
 * provider they left set to create users. That is the same class of authority
 * as an invitation — somebody who holds the workspace already said yes to these
 * people — and it is recorded as rows rather than inferred from the request.
 *
 * Without this, a workspace with a closed portal refused its own employees at
 * its own IdP. The refusal is invisible from the inside: `user.create.before`
 * aborts, the OAuth callback redirects with `unable_to_create_user`, and
 * `handleAutoProvisionAfter` — which would have made them a member — runs in
 * `hooks.after`, downstream of an account that no longer gets created.
 *
 * ## The two facts, and why exactly these two
 *
 * They are the pair `handleAutoProvisionAfter` decides its default-role
 * promotion on, read off the same provider row: `autoCreateUsers`, and a
 * VERIFIED domain of THAT provider matching the address. Reading a different
 * pair would let the two disagree, and the disagreements are both bad — a gate
 * looser than the promoter admits accounts nobody will provision, leaving
 * plain portal users on a closed portal; a gate tighter than the promoter
 * refuses the sign-in the promoter was configured for, which is this defect.
 *
 * Provider-scoped for the same reason the promoter is: a sign-in via provider X
 * is only X's attestation, so X's domains are the only ones it can speak for.
 *
 * ## What this deliberately does not cover
 *
 * `handleAutoProvisionAfter`'s other trust path assigns a role from an IdP's
 * claims and does not require a domain match. That one cannot be mirrored here:
 * the claims are read from the account row, which does not exist yet when this
 * runs. So an IdP that maps roles from claims for people outside its verified
 * domains is still governed by the portal's answer, and on a closed portal
 * those users need an invitation.
 */
async function isSsoAutoProvisionGrant(
  email: string,
  ctx?: { path?: string; params?: Record<string, unknown> } | null
): Promise<boolean> {
  // Path first, so the portal's own doors never pay for the registry read.
  if (ctx?.path !== OIDC_CALLBACK_PATH) return false
  const providerId = ctx.params?.providerId
  if (typeof providerId !== 'string' || providerId === '') return false

  const { listIdentityProviders } =
    await import('@/lib/server/domains/settings/identity-providers.service')
  const provider = (await listIdentityProviders()).find((p) => p.registrationId === providerId)
  if (!provider?.autoCreateUsers) return false

  // The real domain match, not a substring test: it normalises the address's
  // domain and requires `verifiedAt`, so a row somebody typed but never proved
  // grants nothing.
  const { findProviderForDomainEmail } = await import('./provider-ids')
  if (findProviderForDomainEmail(email, [provider]) === null) return false

  log.info(
    { provider_id: providerId, email_domain: email.split('@')[1] ?? null },
    'account creation allowed: identity provider auto-creates users at this domain'
  )
  return true
}
