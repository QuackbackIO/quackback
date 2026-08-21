import { createFileRoute } from '@tanstack/react-router'
import { logger } from '@/lib/server/logger'
import {
  IdentityProjectionWriteError,
  writeIdentityProjection,
} from '@/lib/server/domains/settings/cloud/identity-projection.write'
import { verifyIdentityProjectionToken } from '@/lib/server/domains/settings/cloud/identity-projection.signature'
import { handleProjectionPost } from '@/lib/server/domains/settings/cloud/handle-projection-post'

const log = logger.child({ component: 'identity-projection-endpoint' })

export async function handleIdentityProjection(request: Request): Promise<Response> {
  return handleProjectionPost(request, {
    verify: verifyIdentityProjectionToken,
    write: writeIdentityProjection,
    isWriteError: (error): error is IdentityProjectionWriteError =>
      error instanceof IdentityProjectionWriteError,
    log,
    refusedMessage: 'identity projection refused',
    signatureRefusedMessage: 'identity projection signature refused',
  })
}

export const Route = createFileRoute('/api/internal/identity-projection')({
  server: { handlers: { POST: ({ request }) => handleIdentityProjection(request) } },
})
