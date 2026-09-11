import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { redeemWidgetInstallCode } from '@/lib/server/domains/settings/widget-install-pairing'
import {
  enforcePerIpLimit,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/public-endpoint'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-install-context' })

const bodySchema = z.object({
  code: z.string().trim().min(8).max(80),
})

function isHttpsRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]?.trim() === 'https'
  return new URL(request.url).protocol === 'https:'
}

export async function handleWidgetInstallContext(request: Request): Promise<Response> {
  if (isPooledTenancy() && !isHttpsRequest(request)) {
    return widgetJsonError(400, 'HTTPS_REQUIRED', 'Redeem pairing codes over HTTPS')
  }

  const limited = await enforcePerIpLimit(request, {
    keyPrefix: 'widget:install-context',
    limit: 20,
    windowSeconds: 15 * 60,
    message: 'Too many install attempts, try again later',
  })
  if (limited) return limited

  let code: string
  try {
    const raw = await request.json()
    code = bodySchema.parse(raw).code
  } catch {
    return widgetJsonError(400, 'VALIDATION_ERROR', 'Invalid request body')
  }

  const context = await redeemWidgetInstallCode(code)
  if (!context) {
    return widgetJsonError(404, 'CODE_INVALID', 'Invalid or expired install code')
  }

  log.info('widget install pairing redeemed')
  return Response.json(context, { headers: widgetCorsHeaders() })
}

export const Route = createFileRoute('/api/widget/install-context')({
  server: {
    handlers: {
      POST: async ({ request }) => handleWidgetInstallContext(request),
    },
  },
})
