/**
 * A step of the verified critic loop after a brand match: score the drawn
 * preview (measured and the art director's critic), or propose a revision
 * as an unsaved candidate. JSON in, JSON out (with spaces written before
 * the answer while it is worked on, so the connection never looks idle). Needs the branding permission.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireAuth } from '@/lib/server/functions/auth-helpers'
import { isAuthDenialError } from '@/lib/server/functions/auth-errors'
import { errorResponse, forbiddenResponse } from '@/lib/server/domains/api/responses'
import { logger } from '@/lib/server/logger'
import { jsonWithKeepalive } from '@/lib/server/utils/json-keepalive'
import { PERMISSIONS } from '@/lib/shared/permissions'

const log = logger.child({ route: 'brand-check' })

export async function handleBrandCheck({ request }: { request: Request }): Promise<Response> {
  try {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_BRANDING })
  } catch (error) {
    if (isAuthDenialError(error)) return forbiddenResponse('Branding access required')
    throw error
  }
  // The check after a brand match is a Labs switch, off unless a workspace turns it on.
  const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
  if (!(await isFeatureEnabled('brandCheckLoop')))
    return Response.json({
      ok: false,
      code: 'CHECK_OFF',
      message: 'Checking a brand match is off for this workspace.',
    })
  const { brandCheckRequest, runBrandCheckRequest } =
    await import('@/lib/server/domains/design/ai/brand-check-request')
  const parsed = brandCheckRequest.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('VALIDATION_ERROR', 'The check could not be read.', 400)
  // A step can think for longer than the server keeps a silent connection.
  return jsonWithKeepalive(
    runBrandCheckRequest(parsed.data).catch((err: unknown) => {
      log.error({ err, op: parsed.data.op }, 'brand check failed')
      return {
        ok: false,
        code: 'AI_FAILED',
        message: 'The match could not be checked.',
      }
    })
  )
}

export const Route = createFileRoute('/api/admin/design/brand-check')({
  server: { handlers: { POST: handleBrandCheck } },
})
