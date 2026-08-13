/**
 * The bootstrap-admin invariant, in one place.
 *
 * A workspace hands out its first admin exactly once, and more than one code
 * path can be the one that does it (the onboarding workspace step, and an SSO
 * callback recovering a workspace whose admin is gone). Those paths only
 * exclude each other if they agree on two things, so both live here:
 *
 *  - the advisory-lock key they serialise on. Two different keys are two
 *    different locks, which is the same as no lock at all.
 *  - what counts as an owner. A human principal (`type: 'user'`) holding
 *    `admin`. Service principals are excluded so a config-file-provisioned API
 *    key cannot block the first real person from claiming setup.
 *
 * The claim the unauthenticated first screen reads uses the same predicate, so
 * the screen can never say "unclaimed" while the promoter says "claimed" (that
 * disagreement is what leaves a visitor filling in a form that then refuses
 * them). A blocked admin still owns setup for the same reason: the promoter
 * counts them, so the screen must too.
 */
import { and, eq, principal, sql } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'

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
