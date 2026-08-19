import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

/** Archive the linked Notion page on cascading post delete. */
export async function archiveNotionPage(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${NOTION_API}/pages/${ctx.externalId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ archived: true }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Notion', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}
