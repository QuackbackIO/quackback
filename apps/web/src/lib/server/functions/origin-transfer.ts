import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

export type OriginTransferResult =
  | { kind: 'redirect'; to: string; cookies: string[] }
  | { kind: 'error'; status: 'invalid' | 'error' }

export function isCanonicalIdentityHost(host: string | null, canonicalOrigin: string): boolean {
  if (!host) return false
  const requested = host.trim().toLowerCase().replace(/:\d+$/, '')
  return requested === new URL(canonicalOrigin).hostname
}

function responseCookies(response: Response): string[] {
  const fromGetter = response.headers.getSetCookie?.() ?? []
  if (fromGetter.length > 0) return fromGetter
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * Consume a one-use session handoff on the workspace's current canonical host.
 *
 * Replay, expiry, a missing identity projection, and a host that is not the
 * projected origin all fail closed. The token is not touched until the host
 * check passes, so a transfer presented on the old or system host can still
 * succeed on the new one.
 */
export async function consumeOriginTransfer(input: {
  ott?: string
  returnTo?: string
  host: string | null
  headers?: Headers
}): Promise<OriginTransferResult> {
  const returnTo = isSafeCallbackUrl(input.returnTo) ? input.returnTo : '/admin/settings/general'
  if (!input.ott) return { kind: 'error', status: 'invalid' }

  const { db, settings } = await import('@/lib/server/db')
  const { parseIdentityProjection } =
    await import('@/lib/server/domains/settings/cloud/identity-projection')
  const [row] = await db.select({ identity: settings.cloudIdentity }).from(settings).limit(1)
  const identity = parseIdentityProjection(row?.identity)
  if (!identity || !isCanonicalIdentityHost(input.host, identity.canonicalOrigin)) {
    return { kind: 'error', status: 'invalid' }
  }

  try {
    const { auth } = await import('@/lib/server/auth')
    const headers = new Headers(input.headers)
    headers.set('content-type', 'application/json')
    const response = await auth.handler(
      new Request('http://auth.local/api/auth/one-time-token/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: input.ott }),
      })
    )
    if (!response.ok) return { kind: 'error', status: 'invalid' }
    const cookies = responseCookies(response)
    if (cookies.length === 0) return { kind: 'error', status: 'error' }
    return { kind: 'redirect', to: returnTo, cookies }
  } catch {
    return { kind: 'error', status: 'invalid' }
  }
}

const searchSchema = z.object({
  ott: z.string().optional(),
  returnTo: z.string().optional(),
})

export const consumeOriginTransferFn = createServerFn({ method: 'POST' })
  .validator(searchSchema)
  .handler(async ({ data }): Promise<OriginTransferResult> => {
    const result = await consumeOriginTransfer({
      ...data,
      host: getRequestHeaders().get('host'),
      headers: getRequestHeaders(),
    })
    if (result.kind === 'redirect') {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)(
        'Set-Cookie',
        result.cookies
      )
    }
    return result
  })
