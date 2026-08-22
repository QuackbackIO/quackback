/**
 * Shared auth for fleet-internal HTTP (control plane → worker, and any other
 * replica that is not a tenant).
 *
 * Distinct from:
 *   - per-workspace `QUACKBACK_CP_INTERNAL_TOKEN` (app → CP `/api/v1/internal/*`)
 *   - identity/billing projection JWTs (CP → web, tenant hostname)
 *
 * The token is a fleet-wide secret (`QUACKBACK_FLEET_INTERNAL_TOKEN`), the same
 * value already declared on every app service. There is one check and it is
 * fail-closed: an unset token refuses every caller rather than treating the
 * fleet as open.
 */
import { timingSafeEqual } from 'node:crypto'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'fleet-internal-auth' })

export const FLEET_INTERNAL_TOKEN_ENV = 'QUACKBACK_FLEET_INTERNAL_TOKEN'

function readProvidedToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim())
    if (match) return match[1]
  }
  // Same secret, header form — some internal callers send a raw header rather
  // than a Bearer scheme. Either is enough; both are compared the same way.
  const header = request.headers.get('x-quackback-fleet-internal-token')
  return header && header.length > 0 ? header : null
}

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** True when the request presents the fleet-internal token. */
export function authorizeFleetInternal(request: Request): boolean {
  const expected = process.env[FLEET_INTERNAL_TOKEN_ENV]
  if (!expected) {
    log.warn('QUACKBACK_FLEET_INTERNAL_TOKEN is unset — refusing fleet-internal request')
    return false
  }
  const provided = readProvidedToken(request)
  if (!provided) return false
  return tokensMatch(provided, expected)
}
