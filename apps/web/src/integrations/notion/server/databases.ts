/**
 * Notion database listing.
 */

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

/**
 * List databases accessible to the integration.
 */
export async function listNotionDatabases(
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${NOTION_API}/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to list Notion databases: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    results: Array<{
      id: string
      title: Array<{ plain_text: string }>
    }>
  }

  return data.results.map((db) => ({
    id: db.id,
    name: db.title.map((t) => t.plain_text).join('') || 'Untitled',
  }))
}
