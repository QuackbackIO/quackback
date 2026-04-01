import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/server/auth'
import { db, eq, principal } from '@/lib/server/db'
import { isS3Configured, uploadImageFromFormData } from '@/lib/server/storage/s3'

const ALLOWED_PREFIXES = new Set([
  'uploads',
  'changelog-images',
  'changelog',
  'post-images',
  'help-center',
])

export async function handleAdminUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id),
    columns: { role: true },
  })
  if (!principalRecord || (principalRecord.role !== 'admin' && principalRecord.role !== 'member')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
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
  const rawPrefix = formData.get('prefix')
  const prefix =
    typeof rawPrefix === 'string' && ALLOWED_PREFIXES.has(rawPrefix) ? rawPrefix : 'uploads'
  return uploadImageFromFormData(formData, prefix)
}

export const Route = createFileRoute('/api/upload/image')({
  server: {
    handlers: {
      POST: handleAdminUpload,
    },
  },
})
