import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { consumeOpenHandoff } from './origin-transfer'

/**
 * Runs in the /admin beforeLoad on the original request. A createServerFn
 * RPC from that gate can lose the workspace Host, so Better Auth looks up
 * the token in the wrong database and Open fails closed as handoff_failed.
 */
export async function consumeAdminOpenHandoff(ott: string) {
  const result = await consumeOpenHandoff({
    ott,
    returnTo: '/onboarding/workspace',
    headers: getRequestHeaders(),
  })
  if (result.kind === 'redirect') {
    for (const cookie of result.cookies) {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)('Set-Cookie', cookie)
    }
  }
  return result
}
