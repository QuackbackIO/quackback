/**
 * Build a partial audit context (principal + IP/UA + source) from any
 * AuthContext-like value. Lets write paths emit `recordEvent` without
 * each caller manually re-reading request headers.
 */

import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { PrincipalId } from '@quackback/ids'
import type { AuditSource } from '@/lib/server/db'

export interface AuditAttribution {
  principalId: PrincipalId | null
  ipAddress: string | null
  userAgent: string | null
  source: AuditSource
}

export type AuditAuthLike =
  | (Pick<AuthContext, 'principal' | 'ipAddress' | 'userAgent' | 'source'> & {
      principal: { id: PrincipalId }
    })
  | Pick<ApiAuthContext, 'principalId' | 'ipAddress' | 'userAgent' | 'source'>
  | null
  | undefined

export function buildAuditContext(auth: AuditAuthLike): AuditAttribution {
  if (!auth) {
    return { principalId: null, ipAddress: null, userAgent: null, source: 'system' }
  }
  if ('principal' in auth) {
    return {
      principalId: auth.principal.id,
      ipAddress: auth.ipAddress ?? null,
      userAgent: auth.userAgent ?? null,
      source: auth.source ?? 'web',
    }
  }
  return {
    principalId: auth.principalId,
    ipAddress: auth.ipAddress ?? null,
    userAgent: auth.userAgent ?? null,
    source: auth.source ?? 'api',
  }
}
