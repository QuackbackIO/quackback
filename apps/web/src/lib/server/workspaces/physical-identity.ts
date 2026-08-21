/**
 * The half of the fingerprint a copy of the database cannot forge.
 *
 * `evaluateFingerprint` (vendor/contract.ts) compares two facts that live *in*
 * the workspace database: `settings.id` and the control plane's stamp. Both are
 * data, and `pg_dump`/`CREATE DATABASE … TEMPLATE` copy data — so a clone of a
 * workspace's database satisfies both halves and is served as the real thing
 * unless something that is a property of the *catalog* is compared too.
 *
 * On the fleet Postgres that comparison is `current_database()` plus
 * `pg_database.oid`, recorded at provision. A restore into a new database
 * keeps the stamp and `settings.id` and gets a new oid. A `TEMPLATE` clone
 * does the same. Refusing an oid mismatch is the anti-clone half.
 *
 * A record that claims no catalog oid (self-host) skips this check.
 *
 * Catalog fields are read with ordinary SQL so a self-hosted database answers
 * them.
 */

/** Where the registry says the workspace physically lives. */
export type PhysicalExpectation = {
  /** Expected `current_database()`, or null when not recorded. */
  catalogName: string | null
  /** Expected `pg_database.oid` as decimal text, or null when not recorded. */
  catalogOid: string | null
}

/** What the connected database says about itself. */
export type ObservedPhysicalIdentity = {
  currentDatabase: string | null
  catalogOid: string | null
}

export type PhysicalFailure = 'catalog_name_mismatch' | 'catalog_oid_mismatch'

export type PhysicalVerdict = { ok: true } | { ok: false; code: PhysicalFailure; detail: string }

/**
 * Assert the connected catalog is the one the registry named.
 *
 * Fleet-PG placement is the catalog name + oid. A record claiming neither
 * skips the check — that is self-host.
 */
export function evaluatePhysicalIdentity(
  expected: PhysicalExpectation,
  observed: ObservedPhysicalIdentity
): PhysicalVerdict {
  const expectsCatalog = expected.catalogName !== null || expected.catalogOid !== null
  if (!expectsCatalog) return { ok: true }

  if (expected.catalogName !== null && observed.currentDatabase !== expected.catalogName) {
    return {
      ok: false,
      code: 'catalog_name_mismatch',
      detail: `current_database() is ${observed.currentDatabase ?? 'null'}, expected ${expected.catalogName}`,
    }
  }

  if (expected.catalogOid !== null && observed.catalogOid !== expected.catalogOid) {
    return {
      ok: false,
      code: 'catalog_oid_mismatch',
      detail:
        `pg_database.oid is ${observed.catalogOid ?? 'null'}, expected ${expected.catalogOid} — ` +
        'this is a dump/restore or TEMPLATE clone of the workspace database, not the catalog the ' +
        'registry named. Cloning copies both halves of the content fingerprint',
    }
  }

  return { ok: true }
}
