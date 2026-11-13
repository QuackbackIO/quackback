/**
 * The one log line that says a workspace's upgrade work is finished.
 *
 * After an upgrade, startup backfills and background indexes run as jobs, so
 * the server is serving before the work is done. An operator reads this line
 * to know when it is: every registered backfill and follow-up has its done
 * marker, and no background index is missing or invalid.
 *
 * Checked at startup, on every schedule pass of the upgrade jobs and when a
 * walk or a build finishes. A kv key per build stops a repeat, so the line is
 * written once per workspace and build.
 */
import { createHash } from 'node:crypto'
import { logger } from '@/lib/server/logger'
import { kvSetNx } from '@/lib/server/kv/pg-kv'
import type { JobHandler } from '@/lib/server/jobs/definitions'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import {
  backfillWorkDone,
  DURABLE_KV_TTL_SECONDS,
  enqueueBackfillPass,
  registeredBackfills,
} from './batched'
import {
  deferredIndexSpecs,
  enqueueDeferredIndexBuilds,
  pendingDeferredIndexes,
} from './deferred-indexes'

const log = logger.child({ component: 'upgrade-work' })

function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
}

/**
 * The build, as far as its upgrade work goes: the app version and the set of
 * backfills and background indexes it carries.
 */
function upgradeBuildKey(): string {
  const work = [
    ...registeredBackfills().map((b) => `backfill:${b.name}${b.followUp ? '+follow-up' : ''}`),
    ...deferredIndexSpecs().map((s) => `index:${s.name}`),
  ]
  const digest = createHash('sha256').update(work.join('\n')).digest('hex').slice(0, 12)
  return `${appVersion()}:${digest}`
}

/**
 * The build each workspace's upgrade work was last noted done for in this
 * process, so once it is noted no later check reads kv or the catalogue.
 */
const notedBuild = new WorkspaceKeyedCache<string>(10_000)

/**
 * Log `upgrade work done` if this workspace's upgrade work is finished and this
 * build has not said so yet. Returns true when it logged.
 */
export async function noteUpgradeWorkDone(): Promise<boolean> {
  const build = upgradeBuildKey()
  if (notedBuild.get('build') === build) return false
  if (!(await backfillWorkDone())) return false
  if ((await pendingDeferredIndexes()).length > 0) return false
  const first = await kvSetNx(
    `upgrade-done:${build}`,
    { at: new Date().toISOString() },
    DURABLE_KV_TTL_SECONDS
  )
  notedBuild.set('build', build)
  if (first) {
    log.info(
      {
        event: 'upgrade.done',
        build,
        backfills: registeredBackfills().length,
        background_indexes: deferredIndexSpecs().length,
      },
      'upgrade work done'
    )
  }
  return first
}

/**
 * An upgrade job's handler, followed by the done check once it succeeds, so no
 * upgrade handler can leave it out.
 */
export function upgradeJob(handler: JobHandler): JobHandler {
  return async (job) => {
    await handler(job)
    await noteUpgradeWorkDone()
  }
}

/**
 * What startup runs for each workspace, after its own one-time backfills have
 * committed: enqueue the startup backfills and the background index builds,
 * then say whether the upgrade work is already done. Walks and builds run as
 * jobs; nothing here waits for them.
 */
export async function enqueueUpgradeWork(): Promise<void> {
  await Promise.all([enqueueBackfillPass(), enqueueDeferredIndexBuilds()])
  await noteUpgradeWorkDone()
}
