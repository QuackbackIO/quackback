import { actorFromAuth } from '@/lib/server/audit/log'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import type { DesignAuthor } from './design.service'

/** The person a design write is recorded for, with the request for the audit row. */
export async function designAuthor(auth: AuthContext): Promise<DesignAuthor> {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  return {
    principalId: auth.principal.id,
    actor: actorFromAuth(auth),
    headers: getRequestHeaders(),
  }
}
