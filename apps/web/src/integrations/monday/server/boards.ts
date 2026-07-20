/**
 * Monday.com board listing.
 */

const MONDAY_API = 'https://api.monday.com/v2'

/**
 * List boards accessible to the authenticated user.
 */
export async function listMondayBoards(
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      Authorization: accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '{ boards(limit: 100, order_by: used_at) { id name } }',
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to list Monday.com boards: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    data?: { boards?: Array<{ id: string; name: string }> }
  }

  return (data.data?.boards ?? []).map((b) => ({ id: b.id, name: b.name }))
}
