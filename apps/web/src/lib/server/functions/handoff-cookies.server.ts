import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import {
  consumeOpenHandoff,
  consumeOriginTransfer,
  type OriginTransferResult,
} from './origin-transfer'

function applySessionCookies(result: OriginTransferResult): OriginTransferResult {
  if (result.kind === 'redirect') {
    for (const cookie of result.cookies) {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)('Set-Cookie', cookie)
    }
  }
  return result
}

/**
 * Consume an Open or rename handoff on the incoming workspace request.
 *
 * A createServerFn RPC from the route loader can lose the Host that selects
 * the tenant database, so Better Auth looks up the token in the wrong place
 * and the browser lands on handoff_failed. Call this from the loader instead.
 */
export async function consumeOpenHandoffOnRequest(input: {
  ott?: string
  returnTo?: string
}): Promise<OriginTransferResult> {
  return applySessionCookies(
    await consumeOpenHandoff({
      ...input,
      headers: getRequestHeaders(),
    })
  )
}

export async function consumeOriginTransferOnRequest(input: {
  ott?: string
  returnTo?: string
}): Promise<OriginTransferResult> {
  const headers = getRequestHeaders()
  return applySessionCookies(
    await consumeOriginTransfer({
      ...input,
      host: headers.get('host'),
      headers,
    })
  )
}
