import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

/** Archive the linked Shortcut story on cascading post delete. */
export async function archiveShortcutStory(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${SHORTCUT_API}/stories/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      'Shortcut-Token': ctx.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ archived: true }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Shortcut', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}
