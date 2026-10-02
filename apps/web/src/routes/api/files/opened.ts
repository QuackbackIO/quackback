import { createFileRoute } from '@tanstack/react-router'
import { isValidTypeId, type FileId } from '@quackback/ids'
import { enforcePerIpLimit } from '@/lib/server/widget/public-endpoint'
import { recordFileOpen } from '@/lib/server/domains/files/files.service'

/**
 * POST /api/files/opened?fileId=<id> — the viewer opened a file.
 *
 * Counts opens per file so usage by format is measurable. Sent as a beacon
 * from every surface (inbox, widget, portal), so it takes no session: the id is
 * an unguessable capability and the worst a caller can do is inflate a count.
 */
export async function handleFileOpened({ request }: { request: Request }): Promise<Response> {
  const limited = await enforcePerIpLimit(request, {
    keyPrefix: 'file-opened',
    limit: 120,
    windowSeconds: 60,
  })
  if (limited) return limited
  const fileId = new URL(request.url).searchParams.get('fileId')
  if (!fileId || !isValidTypeId(fileId, 'file')) return new Response(null, { status: 400 })
  await recordFileOpen(fileId as FileId)
  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/api/files/opened')({
  server: { handlers: { POST: handleFileOpened } },
})
