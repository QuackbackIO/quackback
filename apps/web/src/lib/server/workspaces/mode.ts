/**
 * "Is this process pooled?" — answered without loading the app config.
 *
 * `config.isPooledTenancy` is the canonical read and validates the whole
 * configuration on the way. That is right for startup and for the readiness
 * probe. It is wrong for `db.ts`, which 537 files import: making the first `db`
 * access anywhere validate every environment variable in the app turns an
 * unrelated missing `SECRET_KEY` into a database error, and does it inside unit
 * tests that never wanted a config at all.
 *
 * So the two hot paths — the `db` Proxy trap and `withSweepLock` — read the one
 * variable they actually need. `__tests__/mode.test.ts` asserts the two readings
 * agree for every value the schema accepts, so this cannot drift into a second
 * opinion about what "pooled" means.
 */

/** The only value that changes behaviour. Anything else is single-workspace. */
export const POOLED_TENANCY = 'pooled'

export function isPooledTenancy(env: Record<string, string | undefined> = process.env): boolean {
  return env.QUACKBACK_TENANCY === POOLED_TENANCY
}
