/**
 * The bootstrap-admin invariant, in one place.
 *
 * A workspace hands out its first admin exactly once, and more than one code
 * path can be the one that does it (the onboarding workspace step, and an SSO
 * callback recovering a workspace whose admin is gone). Those paths only
 * exclude each other if they agree on three things, so all three live here:
 *
 *  - the advisory-lock key they serialise on. Two different keys are two
 *    different locks, which is the same as no lock at all.
 *  - what counts as an owner. A human principal (`type: 'user'`) holding
 *    `admin`. Service principals are excluded so a config-file-provisioned API
 *    key cannot block the first real person from claiming setup.
 *  - whether arriving at all is a claim. On an install nobody provisioned the
 *    first human genuinely is the owner; on a workspace a control plane created
 *    for a named customer, being first through the door is a race anyone who
 *    can guess a hostname may enter. See {@link isOpenToBootstrapClaim}.
 *
 * The onboarding promoter also asks a fourth, {@link isSetupOpenToClaim}: the
 * workspace step is for finishing setup, so a workspace whose setup is done
 * is not claimable there. The SSO callback does not ask it, because recovering
 * a workspace whose admin is gone is what that path is for, and it already
 * requires an address at a domain this provider verified.
 *
 * On an install whose setup is still open, the onboarding promoter decides one
 * thing more: who claimed it. That is the first human account created there
 * ({@link findSetupClaimant}), not whoever reaches the workspace step first,
 * because the gap between creating an account and finishing that step is a
 * window in which a second visitor could otherwise take the install.
 *
 * Two promoters, and both consult all three: `functions/onboarding.ts`'s
 * `ensureBootstrapAdmin` and `auth/hooks.ts`'s `handleSsoCallbackAfter`. The
 * second one used to consult only the first two, which produced the
 * disagreement in its worst direction — the screen told the browser the
 * workspace was not open to claim while the SSO path promoted the first
 * arrival anyway.
 *
 * The claim the unauthenticated first screen reads uses the same predicates, so
 * the screen can never say "unclaimed" while a promoter says "claimed" (that
 * disagreement is what leaves a visitor filling in a form that then refuses
 * them). A blocked admin still owns setup for the same reason: the promoter
 * counts them, so the screen must too.
 */
import type { UserId } from '@quackback/ids'
import { and, asc, eq, isNotNull, principal, sql } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import { isProvisionedWorkspace } from '@/lib/server/workspaces/provenance'
import {
  getSetupState,
  isOnboardingComplete,
  needsCloudOnboardingWizard,
  type SetupState,
} from '@/lib/shared/db-types'

/** The live db or an open transaction. */
type Executor = Database | Transaction

/**
 * Serialises every path that can promote the first admin. Must be taken
 * INSIDE the transaction and BEFORE the admin set is read: reading first and
 * locking after leaves the window this closes wide open. Released on commit.
 */
export function bootstrapAdminLock() {
  return sql`select pg_advisory_xact_lock(hashtextextended('quackback:bootstrap-admin', 0))`
}

/** Who owns a workspace's setup: a human principal holding admin. */
function humanAdminWhere() {
  return and(eq(principal.role, 'admin'), eq(principal.type, 'user'))
}

/** The owning principal's id, or undefined when nobody has claimed setup. */
export async function findHumanAdmin(exec: Executor): Promise<{ id: string } | undefined> {
  return exec.query.principal.findFirst({
    where: humanAdminWhere(),
    columns: { id: true },
  })
}

/**
 * May whoever arrives first become this workspace's admin?
 *
 * Yes on an install nobody provisioned: somebody unpacked it, and the first
 * human through the door is the owner by construction. That is the product's
 * normal install and it must keep working exactly as it always has.
 *
 * No on a workspace a control plane created. Such a workspace already belongs
 * to a named customer before anyone signs in, its hostname sits under a domain
 * whose names are enumerable, and "find one nobody has signed into yet" is
 * therefore a search rather than a guess. Its owner is recorded where it was
 * created; arrival is not evidence of being that person.
 *
 * The distinguishing fact is the control plane's own stamp on the workspace's
 * database, not a setting, a hostname or a build-time environment name — see
 * {@link isProvisionedWorkspace}. Cloud is off by default in this codebase and
 * nothing here learns otherwise.
 *
 * When that fact cannot be determined, {@link isProvisionedWorkspace} answers
 * "provisioned" and this answers "not open". A workspace nobody can classify is
 * therefore claimable by nobody rather than by anybody: the cost is a
 * self-hosted install with a corrupted `settings` table needing its first admin
 * set directly, and the alternative cost is handing a real customer's workspace
 * to whoever asked first.
 *
 * Take the transaction, not the pool: every caller decides under
 * {@link bootstrapAdminLock}, and a second connection would answer from outside
 * that window.
 */
export async function isOpenToBootstrapClaim(exec: Executor): Promise<boolean> {
  return !(await isProvisionedWorkspace(exec))
}

/**
 * Is this workspace's setup still waiting for its owner to finish it?
 *
 * The onboarding claim is a way to finish setting a workspace up, not a way
 * into one that is already running. Without this, an install whose human
 * admins are all gone (only service principals left) handed admin, and the
 * workspace name, slug and modules, to whichever signed-in user posted the
 * workspace step first, portal users included.
 *
 * "Still open" is the same answer the onboarding layout routes on: setup is
 * finished once the wizard's steps are complete, unless a declarative config
 * file or a provisioner stamped them complete before the owner ever arrived
 * ({@link needsCloudOnboardingWizard}). That pre-stamped workspace has no owner
 * yet and its first user must still be able to claim it. No settings row is a
 * fresh install, which is open.
 *
 * Take the transaction, not the pool, for the same reason as
 * {@link isOpenToBootstrapClaim}.
 */
export async function isSetupOpenToClaim(exec: Executor): Promise<boolean> {
  const rows = await readSetupStates(exec)
  if (rows.length === 0) return true
  // Not a singleton: no honest answer, so refuse rather than open.
  if (rows.length > 1) return false
  return isSetupStateOpen(getSetupState(rows[0]!))
}

/** Up to two stored setup states: enough to tell none, one and too many apart. */
async function readSetupStates(exec: Executor): Promise<Array<string | null>> {
  const result = await exec.execute(
    sql`SELECT s.setup_state AS setup_state FROM settings s LIMIT 2`
  )
  const rows = (result ?? []) as unknown as Array<{ setup_state: string | null }>
  return rows.map((row) => row.setup_state ?? null)
}

/**
 * {@link isSetupOpenToClaim} for a setup state already in hand, such as one
 * read under the settings row lock. Kept as one function so a write that
 * re-checks under its own lock asks exactly the question the early check did.
 */
export function isSetupStateOpen(state: SetupState | null): boolean {
  return !isOnboardingComplete(state) || needsCloudOnboardingWizard(state)
}

/**
 * Does the first account created on this workspace own its setup?
 *
 * Yes on an install nobody provisioned whose setup is not finished. Nothing but
 * the wizard is reachable there (the root gate returns every other page to
 * onboarding), so every account on it was made to set it up, and the first one
 * belongs to whoever is doing that. Deciding at the workspace step instead left
 * the time between creating an account and finishing that step open to anyone
 * else who created one.
 *
 * No on a provisioned workspace, whose owner is recorded where it was created.
 * No once setup reads complete, including on a workspace the config file
 * stamped complete before its owner arrived: its portal is live, people sign up
 * there to leave feedback, and being first to sign up says nothing about who
 * set it up. A stamp is not an owner, so that workspace's first user still
 * claims it at the workspace step.
 *
 * Take the transaction, not the pool, for the same reason as
 * {@link isOpenToBootstrapClaim}.
 */
async function isSetupClaimedByFirstAccount(exec: Executor): Promise<boolean> {
  if (!(await isOpenToBootstrapClaim(exec))) return false
  const rows = await readSetupStates(exec)
  if (rows.length === 0) return true
  if (rows.length > 1) return false
  return !isOnboardingComplete(getSetupState(rows[0]!))
}

/**
 * The account that has claimed setup, where the first account does (see
 * {@link isSetupClaimedByFirstAccount}). Undefined anywhere else, and before
 * anyone has an account.
 *
 * The first human account, never an anonymous visitor: the widget mints
 * anonymous principals for people who have not signed up, and one that arrives
 * first must not own the install. Ties on creation time break on id, so every
 * reader names the same account.
 *
 * Says nothing about whether that account holds admin yet: the workspace step
 * is where the claimant is promoted.
 */
export async function findSetupClaimant(exec: Executor): Promise<{ userId: UserId } | undefined> {
  if (!(await isSetupClaimedByFirstAccount(exec))) return undefined
  const first = await exec.query.principal.findFirst({
    where: and(eq(principal.type, 'user'), isNotNull(principal.userId)),
    columns: { userId: true },
    orderBy: [asc(principal.createdAt), asc(principal.id)],
  })
  return first?.userId ? { userId: first.userId } : undefined
}
