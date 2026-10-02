import { createFileRoute } from '@tanstack/react-router'
import type { UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth'
import { toSessionScope } from '@/lib/shared/roles'
import { db, eq, principal } from '@/lib/server/db'
import { handleFileUploadRequest } from '@/lib/server/domains/files/files.upload'

/** POST /api/upload/file?name=<file name> — a team member attaching a file. */
export async function handleAgentFileUpload({ request }: { request: Request }): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (toSessionScope(session.session.scope) !== 'dashboard') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const member = await db.query.principal.findFirst({
    where: eq(principal.userId, session.user.id as UserId),
    columns: { id: true, role: true },
  })
  if (!member || (member.role !== 'admin' && member.role !== 'member')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return handleFileUploadRequest(request, {
    source: 'agent',
    uploadedById: member.id,
    unverifiedSender: false,
  })
}

export const Route = createFileRoute('/api/upload/file')({
  server: { handlers: { POST: handleAgentFileUpload } },
})
