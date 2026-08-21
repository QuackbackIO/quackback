/**
 * Configuration that must be right before this process does anything at all.
 *
 * A deliberately tiny leaf module — it imports the two validators and a logger
 * and nothing else — so it can be the **first statement** in `server.ts`, above
 * the eager DB/Redis warmup. That placement is the point: an earlier version
 * asserted inside `logStartupBanner()`, which runs *after* the warmup fires, so
 * "we refuse before opening a connection" was true only because a synchronous
 * throw beat a microtask. True by 115 ms is not the same as true by
 * construction, and the next person to reorder two lines would not know they
 * had broken it.
 *
 * ## Why it exits rather than throws
 *
 * Throwing here is worse than useless. The throw happens during ESM module
 * evaluation of the server entry, **Node caches the module-evaluation error**,
 * and every route then 500s forever — `/api/health/live` included, so a
 * supervisor watching liveness sees a process that is up and answering. It also
 * does not stop: measured, a process in that state kept its socket open and
 * made **7,417 connection attempts** to the database it had just declared
 * itself unfit to serve. On a pooled fleet each of those wakes a workspace
 * database, so a single mistyped variable becomes a fleet-wide cost and
 * availability problem rather than one dead replica.
 *
 * A non-zero exit is the correct failure for bad configuration. A supervisor
 * can see a crash loop, it stops the dialling, and it cannot be mistaken for a
 * healthy process.
 *
 * ## Why there is no readiness check for any of this
 *
 * Because after this function returns, a process with bad configuration does
 * not exist. A readiness branch for it would be unreachable code that reads as
 * coverage — which is worse than no branch, because it invites the reader to
 * believe the case is handled somewhere.
 */
import { logger } from '@/lib/server/logger'
import { assertSchemaFloorConfigured } from '@/lib/server/fleet/schema-floor'
import { assertProcessRoleConfigured } from '@/lib/server/process-role'

const log = logger.child({ component: 'boot-config' })

/**
 * Validate the environment, or exit non-zero.
 *
 * `exit` is injected so the behaviour can be tested without ending the test
 * runner; production callers pass nothing.
 */
export function assertBootConfigurationOrExit(
  deps: { env?: NodeJS.ProcessEnv; exit?: (code: number) => never } = {}
): void {
  const env = deps.env ?? process.env
  const exit = deps.exit ?? ((code: number) => process.exit(code))

  // Skipped during the build: the server entry is evaluated to generate the
  // route manifest, in an environment that is not the one it will run in, so a
  // build-time reading of these variables says nothing.
  if (env.QUACKBACK_BUILD === '1') return

  try {
    assertProcessRoleConfigured(env)
    assertSchemaFloorConfigured(env)
  } catch (err) {
    // The message names the variable and what is wrong with it. This is a boot
    // log on a process that is about to die, not an HTTP response, so it is the
    // one place the offending value belongs — an operator staring at a crash
    // loop needs to see what they typed.
    log.error(
      { err },
      'REFUSING TO START: this process is misconfigured. Exiting 1 rather than serving — ' +
        'a process that cannot resolve its own configuration would 500 every route while ' +
        'still dialling every workspace database.'
    )
    exit(1)
  }
}
