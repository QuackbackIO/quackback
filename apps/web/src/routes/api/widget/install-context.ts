import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { checkWidgetInstallContextRateLimit } from '@/lib/server/auth/widget-rate-limit'
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import {
  isHttpsRequest,
  redeemWidgetInstallCode,
} from '@/lib/server/domains/settings/widget-install-pairing'
import { widgetCorsHeaders, widgetJsonError } from '@/lib/server/widget/public-endpoint'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-install-context' })

const bodySchema = z.object({
  code: z.string().trim().min(8).max(80),
})

export async function handleWidgetInstallContext(request: Request): Promise<Response> {
  if (isPooledTenancy() && !isHttpsRequest(request)) {
    return widgetJsonError(400, 'HTTPS_REQUIRED', 'Redeem pairing codes over HTTPS')
  }

  const rl = await checkWidgetInstallContextRateLimit(getClientIp(request)).catch(() => ({
    allowed: true as const,
  }))
  if (!rl.allowed) {
    return widgetJsonError(429, 'RATE_LIMITED', 'Too many install attempts, try again later', {
      'Retry-After': String(rl.retryAfter ?? 60),
    })
  }

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
