import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'
import {
  BillingProjectionWriteError,
  writeBillingProjection,
} from '@/lib/server/domains/settings/cloud/billing-projection.write'
import { verifyBillingProjectionToken } from '@/lib/server/domains/settings/cloud/billing-projection.signature'
import { handleProjectionPost } from '@/lib/server/domains/settings/cloud/handle-projection-post'

const log = logger.child({ component: 'billing-projection-endpoint' })

export async function handleBillingProjection(request: Request): Promise<Response> {
  return handleProjectionPost(request, {
    verify: verifyBillingProjectionToken,
    write: writeBillingProjection,
    isWriteError: (error): error is BillingProjectionWriteError =>
      error instanceof BillingProjectionWriteError,
    log,
    refusedMessage: 'billing projection refused',
    signatureRefusedMessage: 'billing projection signature refused',
  })
}

export const Route = createFileRoute('/api/internal/billing-projection')({
  server: { handlers: { POST: ({ request }) => handleBillingProjection(request) } },
})
