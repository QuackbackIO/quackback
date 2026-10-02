import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/rate-bucket'
import { handleFileUploadRequest } from '@/lib/server/domains/files/files.upload'

/** POST /api/portal/files?name=<file name> — a signed-in portal user attaching a file. */
export async function handlePortalFileUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const record = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { id: true, type: true },
  })
  if (!record) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const bucket = { key: `portal-file-upload:user:${session.user.id}`, windowSeconds: 60 }
  const { count } = await incrementBucket(bucket)
  if (count !== null && count > 20) {
    const retryAfter = await bucketRetryAfter(bucket)
    return Response.json(
      { error: 'Too many uploads, slow down' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  return handleFileUploadRequest(request, {
    source: 'portal',
    uploadedById: record.id,
    unverifiedSender: record.type !== 'user',
  })
}

export const Route = createFileRoute('/api/portal/files')({
  server: { handlers: { POST: handlePortalFileUpload } },
})
