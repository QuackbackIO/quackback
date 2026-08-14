import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { OriginTransferResult } from './origin-transfer'

/**
 * Client-safe RPC. Implementation stays on the server so /admin cannot pull
 * start/server into the admin layout chunk.
 */
export const consumeAdminOpenHandoffFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ott: z.string().min(1),
      returnTo: z.string().optional(),
    })
  )
  .handler(async ({ data }): Promise<OriginTransferResult> => {
    const { consumeOpenHandoff } = await import('./origin-transfer')
    const { getRequestHeaders, setResponseHeader } = await import('@tanstack/react-start/server')
    const result = await consumeOpenHandoff({
      ott: data.ott,
      returnTo: data.returnTo,
      headers: getRequestHeaders(),
    })
    if (result.kind === 'redirect') {
      for (const cookie of result.cookies) {
        ;(setResponseHeader as (name: string, value: string | string[]) => void)(
          'Set-Cookie',
          cookie
        )
      }
    }
    return result
  })
