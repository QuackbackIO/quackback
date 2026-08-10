/**
 * Dereferencing a `neon+role://` credential ref.
 *
 * The registry stores references, never passwords — `docs/workspace-registry-contract.md`
 * §5. Neon holds the role password itself (`store_passwords`) and exposes it via
 * `reveal_password`, so the control plane can name the credential without ever
 * storing it, and `reset_password` gives the scheme a real rotation story rather
 * than a promise of one.
 *
 * Every ref component is interpolated into a URL path, so `parseSecretRef`'s
 * narrow shapes are load-bearing, not cosmetic: an unvalidated ref against an
 * organisation-wide API key is a request-forgery primitive.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'neon-credentials' })

const NEON_API_BASE = process.env.NEON_API_BASE ?? 'https://console.neon.tech/api/v2'

/**
 * Short-lived memo, keyed by project/branch/role.
 *
 * Long enough that a burst of pool creations does not fan out into N API calls
 * (Neon allows 700 req/min), short enough that a rotation is picked up without
 * an operator action. `postgres.js` calls the password provider on **every new
 * connection**, so without this a busy workspace would hammer the management API.
 */
const PASSWORD_TTL_MS = 60_000
const cache = new Map<string, { password: string; expiresAt: number }>()

export class NeonCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NeonCredentialError'
  }
}

export interface NeonRoleTarget {
  projectId: string
  branchId: string
  role: string
}

/** Drop a memoised password, so the next connection re-reads it. */
export function invalidateNeonRolePassword(target: NeonRoleTarget): void {
  cache.delete(cacheKey(target))
}

/** Drop every memoised password. Used by tests and by the pool-cache reset. */
export function clearNeonCredentialCache(): void {
  cache.clear()
}

export async function readNeonRolePassword(target: NeonRoleTarget): Promise<string> {
  const key = cacheKey(target)
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.password

  const apiKey = config.neonApiKey
  if (!apiKey) {
    throw new NeonCredentialError(
      'NEON_API_KEY is not set; this process cannot dereference neon+role:// refs'
    )
  }

  const url =
    `${NEON_API_BASE}/projects/${encodeURIComponent(target.projectId)}` +
    `/branches/${encodeURIComponent(target.branchId)}` +
    `/roles/${encodeURIComponent(target.role)}/reveal_password`

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    // Never log the body: an error payload from a credential endpoint is exactly
    // the thing that must not reach a log aggregator.
    log.error(
      { projectId: target.projectId, branchId: target.branchId, status: res.status },
      'neon reveal_password failed'
    )
    throw new NeonCredentialError(
      `Neon reveal_password returned ${res.status} for ${target.projectId}/${target.branchId}`
    )
  }

  const body = (await res.json()) as { password?: unknown }
  if (typeof body.password !== 'string' || body.password === '') {
    throw new NeonCredentialError(
      `Neon reveal_password returned no password for ${target.projectId}/${target.branchId}`
    )
  }

  cache.set(key, { password: body.password, expiresAt: Date.now() + PASSWORD_TTL_MS })
  return body.password
}

function cacheKey(target: NeonRoleTarget): string {
  return `${target.projectId}/${target.branchId}/${target.role}`
}
