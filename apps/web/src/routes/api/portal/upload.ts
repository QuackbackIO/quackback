import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { isS3Configured, uploadImageFromFormData } from '@/lib/server/storage/s3'
import { getPublicOriginFromRequest } from '@/lib/server/integrations/oauth'

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
  if (!isS3Configured()) {
    return Response.json({ error: 'Storage not configured' }, { status: 503 })
  }
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }
  return uploadImageFromFormData(formData, 'portal-images', getPublicOriginFromRequest(request))
}

export const Route = createFileRoute('/api/portal/upload')({
  server: {
    handlers: {
      POST: handlePortalUpload,
    },
  },
})
