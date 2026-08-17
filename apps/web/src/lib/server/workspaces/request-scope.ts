/**
 * Workspace resolution middleware — the Host header decides the database.
 *
 * Registered immediately after `request-context.ts` and **before** everything
 * else, CSRF included. That ordering is the whole point of the piece:
 * `request-context.ts` has always enriched `workspace_key` "once auth resolves", but
 * auth resolution is itself full of `db.query.*` calls, so a workspace decided at
 * that moment is decided long after the connection it was supposed to choose.
 * This runs first, touches only the control database, and hands everything
 * downstream a workspace that is already verified.
 *
 * Under `QUACKBACK_TENANCY=single` this is a pass-through and the process
 * behaves exactly as it always has.
 *
 * ## What happens on each failure
 *
 * | Outcome | Status | Database touched |
 * | --- | --- | --- |
 * | `unknown_host` — no record claims this hostname | 404 | none |
 * | `redirect` — obsolete friendly platform hostname | 308 for GET/HEAD, 409 otherwise | none |
 * | `suspended` — record exists, gated off | 403 + `reason` | none |
 * | `deleting` — teardown in flight | 410 | none |
 * | `invalid` — a record exists but fails the contract | 503, alert | none |
 * | `refused` — the database is not the one the record named | 503, alert | one query |
 * | `refused[schema_below_floor]` — right database, schema too old for this build | 503 + `Retry-After`, warn | one query |
 * | `refused[schema_floor_misconfigured]` — this process's own MIN_SCHEMA_VERSION is unresolvable | 503, alert | none |
 * | `refused[secret_key_canary_*]` — right database, wrong key | 503, alert naming the KEY, not the database | one query |
 * | `refused[*]` — credential, connectivity, anything else | 503, alert, NOT the fingerprint alarm | varies |
 *
 * Every one of them is a refusal to serve. None degrades to a default workspace,
 * because §3's failure mode is precisely that a wrong-but-plausible answer looks
 * correct all the way down.
 */
import { logger } from '@/lib/server/logger'
import {
  SCHEMA_FLOOR_MISCONFIGURED_CODE,
  SCHEMA_FLOOR_REFUSAL_CODE,
} from '@/lib/server/fleet/schema-floor'
import { isIdentityFailureCode, isKeyCustodyFailureCode } from './fingerprint'
import { acquireScopeForHost } from './resolver'
import { requestWorkspaceHost } from './saas-edge-host'
import { runWithWorkspaceScope } from './workspace-context'

/** Cache-Control on every refusal: a routing decision must never be cached. */
const NO_STORE = { 'cache-control': 'no-store' } as const

function refusal(status: number, body: string, extra?: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE, ...extra },
  })
}

/**
 * Resolve the workspace for `request` and run `next` inside its scope, or return
 * the refusal. Framework-free so it can be unit tested against a plain Request.
 */
/**
 * Paths that belong to the fleet, not to a workspace.
 *
 * The platform hits these every couple of seconds, and on a wildcard domain
 * they arrive on a workspace hostname like everything else. Resolving a workspace for
 * them would open a pool — and therefore **wake a suspended Neon compute** —
 * once per probe, forever, which silently destroys the idle-cost model the
 * pooling exists for. Readiness under pooled tenancy asserts only that the
 * process can reach the control store, so it needs no workspace either.
 */
const FLEET_PATHS = ['/api/health', '/api/health/ready']

export { requestWorkspaceHost } from './saas-edge-host'

export async function resolveWorkspaceAndContinue<T>({
  request,
  next,
  log = logger,
}: {
  request: Request
  next: () => Promise<T>
  log?: Pick<typeof logger, 'warn' | 'error' | 'info'>
}): Promise<T | Response> {
  if (FLEET_PATHS.includes(new URL(request.url).pathname)) return next()

  const host = requestWorkspaceHost(request)
  const acquisition = await acquireScopeForHost(host, 'request')

  switch (acquisition.kind) {
    case 'ok':
      return runWithWorkspaceScope(acquisition.scope, next)

    case 'unknown_host':
      log.warn({ host: acquisition.hostname }, 'no workspace claims this hostname')
      return refusal(404, 'Unknown workspace')

    case 'redirect': {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        log.warn(
          {
            workspaceKey: acquisition.workspaceKey,
            host: acquisition.hostname,
            method: request.method,
          },
          'unsafe request refused on obsolete workspace hostname'
        )
        return refusal(409, 'This workspace URL has changed. Reload from its current address.')
      }
      const target = new URL(request.url)
      const canonical = new URL(acquisition.location)
      target.protocol = canonical.protocol
      target.hostname = canonical.hostname
      target.port = ''
      log.info(
        {
          workspaceKey: acquisition.workspaceKey,
          from: acquisition.hostname,
          to: canonical.hostname,
        },
        'redirecting obsolete workspace hostname'
      )
      return new Response(null, {
        status: 308,
        headers: { location: target.toString(), ...NO_STORE },
      })
    }

    case 'suspended':
      log.warn(
        { workspaceKey: acquisition.workspaceKey, reason: acquisition.reason },
        'workspace is suspended'
      )
      return refusal(403, `This workspace is suspended (${acquisition.reason}).`)

    case 'deleting':
      log.warn({ workspaceKey: acquisition.workspaceKey }, 'workspace is being deleted')
      return refusal(410, 'This workspace has been removed.')

    case 'invalid':
      // Should essentially never fire: the control plane's write path refuses
      // to commit a record its own reader would reject. If it does, something
      // edited the control database by hand or the reader is older than the
      // writer. Never serve it, and never degrade to a default.
      log.error(
        { workspaceKey: acquisition.workspaceKey, host, problems: acquisition.problems },
        'workspace registry record is invalid — refusing to serve'
      )
      return refusal(503, 'This workspace is temporarily unavailable.')

    case 'refused': {
      // EVERY exception from pool checkout arrives here with a `code`, and they
      // do not mean the same thing. This branch used to end in the fingerprint
      // message as its fallthrough, so a missing credential, an unreachable
      // compute or a typo'd MIN_SCHEMA_VERSION all reported as a wrong-database
      // near-miss — §3's cross-workspace alarm, the one an operator reads as a
      // tenancy breach. Measured: `MIN_SCHEMA_VERSION=9999` 503'd every workspace,
      // healthy ones included, under that message.
      //
      // So the fingerprint message is now emitted only for codes that ARE
      // identity failures, and the list is compiler-checked against the union
      // in both directions. There is no fallthrough into it.
      const { workspaceKey, code, detail } = acquisition
      if (code === SCHEMA_FLOOR_REFUSAL_CODE) {
        log.warn(
          { workspaceKey, code, detail },
          'workspace schema is below MIN_SCHEMA_VERSION — this workspace is updating'
        )
        return refusal(
          503,
          'This workspace is being updated. It will be available again shortly.',
          // A rollout is measured in minutes per workspace; a client that retries
          // sooner than this is adding load to a database that is migrating.
          { 'retry-after': '30' }
        )
      }
      if (code === SCHEMA_FLOOR_MISCONFIGURED_CODE) {
        // Not the workspace's fault and not survivable by waiting: this process
        // cannot resolve its own serving floor, so it is refusing every workspace.
        // Startup validation should have caught it; if this fires, it did not.
        log.error(
          { workspaceKey, code, detail },
          'MIN_SCHEMA_VERSION does not name a bundled migration — this process is misconfigured ' +
            'and is refusing every workspace'
        )
        return refusal(503, 'This workspace is temporarily unavailable.')
      }
      if (isIdentityFailureCode(code)) {
        log.error(
          { workspaceKey, code, detail },
          'workspace database refused the fingerprint — refusing to serve'
        )
        return refusal(503, 'This workspace is temporarily unavailable.')
      }
      if (isKeyCustodyFailureCode(code)) {
        // Deliberately NOT the fingerprint alarm. The database can be exactly
        // the right one while the key is wrong, and an operator reading a
        // tenancy-breach alarm would go looking at the registry when the repair
        // is a custody script. `detail` carries that script and the reason
        // provisioning will not run it.
        log.error(
          { workspaceKey, code, detail },
          'the workspace key and the workspace database do not belong to each other — refusing to serve'
        )
        return refusal(503, 'This workspace is temporarily unavailable.')
      }
      // Everything else: the connection could not be opened or verified for a
      // reason that says nothing about which database it is. Loud, but not the
      // cross-workspace alarm.
      log.error(
        { workspaceKey, code, detail },
        'could not open a verified connection for this workspace — refusing to serve'
      )
      return refusal(503, 'This workspace is temporarily unavailable.')
    }
  }
}
