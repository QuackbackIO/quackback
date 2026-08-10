/**
 * The half of the fingerprint a copy-on-write branch cannot forge.
 *
 * `evaluateFingerprint` (vendor/contract.ts) compares two facts that live *in*
 * the workspace database: `settings.id` and the control plane's stamp. Both are
 * data, and Neon branching copies data — so a branch of a workspace's database
 * satisfies both halves and is served as the real thing:
 *
 *   REAL   ws=019fde94-…  stamp workspaceKey=inst_gauntlet_alpha   verdict {"ok":true}
 *   BRANCH ws=019fde94-…  stamp workspaceKey=inst_gauntlet_alpha   verdict {"ok":true}
 *
 * That matters more than it first looks, because branching is exactly what
 * SAAS-HOSTING-STACK.md §10.8 recommends for migration preflight and what makes
 * Neon attractive: **the most likely operational mistake is the one the content
 * fingerprint cannot catch.** A record accidentally repointed at a restore, a
 * PITR branch or a staging branch reads as valid all the way down.
 *
 * The fix is to compare something that is a property of the *compute* rather
 * than of the data. Neon publishes exactly that as GUCs, and they are visible
 * through the pooled endpoint as well as the direct one (verified 2026-08-08 on
 * a live project, both endpoints, identical values):
 *
 *   neon.project_id   tiny-credit-36813255
 *   neon.branch_id    br-weathered-lake-aupi87in
 *   neon.endpoint_id  ep-tiny-poetry-auqd4saj
 *
 * A branch of that database reports a different `neon.branch_id` while carrying
 * a byte-identical stamp, which is the whole point.
 *
 * Read with `current_setting(name, true)` so a plain Postgres (self-hosted, or
 * the docker-compose dev database) returns NULL instead of erroring.
 */

/** Where the registry says the workspace physically lives. */
export type PhysicalExpectation = {
  /** Neon project id, or null when the workspace is not on Neon. */
  neonProjectId: string | null
  /** Neon branch id (`br-…`), or null when the workspace is not on Neon. */
  neonBranchId: string | null
}

/** What the connected database says about itself. */
export type ObservedPhysicalIdentity = {
  neonProjectId: string | null
  neonBranchId: string | null
  neonEndpointId: string | null
}

export type PhysicalFailure =
  | 'neon_identity_unavailable'
  | 'neon_project_mismatch'
  | 'neon_branch_mismatch'

export type PhysicalVerdict = { ok: true } | { ok: false; code: PhysicalFailure; detail: string }

/**
 * Assert the connected compute is the one the registry named.
 *
 * Fails closed in the direction that matters: a record that *claims* a Neon
 * branch and reaches a database that cannot name one is refused, because that
 * is what a proxy, a tunnel, or a restore into ordinary Postgres looks like.
 * A record claiming no Neon placement (a self-hosted workspace) skips the check
 * entirely — there is nothing to compare, and inventing a comparison would only
 * produce false refusals.
 */
export function evaluatePhysicalIdentity(
  expected: PhysicalExpectation,
  observed: ObservedPhysicalIdentity
): PhysicalVerdict {
  const expectsNeon = expected.neonProjectId !== null || expected.neonBranchId !== null
  if (!expectsNeon) return { ok: true }

  if (observed.neonProjectId === null && observed.neonBranchId === null) {
    return {
      ok: false,
      code: 'neon_identity_unavailable',
      detail:
        'registry places this workspace on Neon but the connected database reports no ' +
        'neon.project_id/neon.branch_id — it is not the compute the record names',
    }
  }

  if (expected.neonProjectId !== null && observed.neonProjectId !== expected.neonProjectId) {
    return {
      ok: false,
      code: 'neon_project_mismatch',
      detail: `neon.project_id is ${observed.neonProjectId ?? 'null'}, expected ${expected.neonProjectId}`,
    }
  }

  if (expected.neonBranchId !== null && observed.neonBranchId !== expected.neonBranchId) {
    return {
      ok: false,
      code: 'neon_branch_mismatch',
      detail:
        `neon.branch_id is ${observed.neonBranchId ?? 'null'}, expected ${expected.neonBranchId} — ` +
        'this is a branch of the workspace database, not the workspace database. Branching copies both ' +
        'halves of the content fingerprint, so this check is the only one that can see it',
    }
  }

  return { ok: true }
}
