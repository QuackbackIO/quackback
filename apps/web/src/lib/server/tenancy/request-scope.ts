/**
 * Tenant resolution middleware — the Host header decides the database.
 *
 * Registered immediately after `request-context.ts` and **before** everything
 * else, CSRF included. That ordering is the whole point of the piece:
 * `request-context.ts` has always enriched `tenant_id` "once auth resolves", but
 * auth resolution is itself full of `db.query.*` calls, so a tenant decided at
 * that moment is decided long after the connection it was supposed to choose.
 * This runs first, touches only the control database, and hands everything
 * downstream a tenant that is already verified.
 *
 * Under `QUACKBACK_TENANCY=single` this is a pass-through and the process
 * behaves exactly as it always has.
 *
 * ## What happens on each failure
 *
 * | Outcome | Status | Database touched |
 * | --- | --- | --- |
 * | `unknown_host` — no record claims this hostname | 404 | none |
 * | `suspended` — record exists, gated off | 403 + `reason` | none |
 * | `deleting` — teardown in flight | 410 | none |
 * | `invalid` — a record exists but fails the contract | 503, alert | none |
 * | `refused` — the database is not the one the record named | 503, alert | one query |
 *
 * Every one of them is a refusal to serve. None degrades to a default tenant,
 * because §3's failure mode is precisely that a wrong-but-plausible answer looks
 * correct all the way down.
 */
import { logger } from '@/lib/server/logger'
import { acquireScopeForHost } from './resolver'
import { runWithTenantScope } from './tenant-context'

/** Cache-Control on every refusal: a routing decision must never be cached. */
const NO_STORE = { 'cache-control': 'no-store' } as const

function refusal(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
  })
}

/**
 * Resolve the tenant for `request` and run `next` inside its scope, or return
 * the refusal. Framework-free so it can be unit tested against a plain Request.
 */
export async function resolveTenantAndContinue<T>({
  request,
  next,
  log = logger,
}: {
  request: Request
  next: () => Promise<T>
  log?: Pick<typeof logger, 'warn' | 'error' | 'info'>
}): Promise<T | Response> {
  const host = request.headers.get('host')
  const acquisition = await acquireScopeForHost(host, 'request')

  switch (acquisition.kind) {
    case 'ok':
      return runWithTenantScope(acquisition.scope, next)

    case 'unknown_host':
      log.warn({ host: acquisition.hostname }, 'no tenant claims this hostname')
      return refusal(404, 'Unknown workspace')

    case 'suspended':
      log.warn(
        { tenantId: acquisition.tenantId, reason: acquisition.reason },
        'tenant is suspended'
      )
      return refusal(403, `This workspace is suspended (${acquisition.reason}).`)

    case 'deleting':
      log.warn({ tenantId: acquisition.tenantId }, 'tenant is being deleted')
      return refusal(410, 'This workspace has been removed.')

    case 'invalid':
      // Should essentially never fire: the control plane's write path refuses
      // to commit a record its own reader would reject. If it does, something
      // edited the control database by hand or the reader is older than the
      // writer. Never serve it, and never degrade to a default.
      log.error(
        { tenantId: acquisition.tenantId, host, problems: acquisition.problems },
        'tenant registry record is invalid — refusing to serve'
      )
      return refusal(503, 'This workspace is temporarily unavailable.')

    case 'refused':
      log.error(
        { tenantId: acquisition.tenantId, code: acquisition.code, detail: acquisition.detail },
        'tenant database refused the fingerprint — refusing to serve'
      )
      return refusal(503, 'This workspace is temporarily unavailable.')
  }
}
