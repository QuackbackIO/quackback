import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { isS3Configured, uploadImageFromFormData } from '@/lib/server/storage/s3'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/rate-bucket'

export async function handlePortalUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { type: true },
  })
  if (!principalRecord || principalRecord.type === 'anonymous') {
    return Response.json({ error: 'Authentication required to upload images' }, { status: 403 })
  }
  const bucket = { key: `portal-upload:user:${session.user.id}`, windowSeconds: 60 }
  const { count } = await incrementBucket(bucket)
  if (count !== null && count > 20) {
    const retryAfter = await bucketRetryAfter(bucket)
    return Response.json(
      { error: 'Too many uploads, slow down' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }
  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadImageFromFormData(formData, 'portal-images')
}

export const Route = createFileRoute('/api/portal/upload')({
  server: {
    handlers: {
      POST: handlePortalUpload,
    },
  },
})
