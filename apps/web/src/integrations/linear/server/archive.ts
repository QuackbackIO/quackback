import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const LINEAR_API = 'https://api.linear.app/graphql'

/** Archive the linked Linear issue on cascading post delete. */
export async function archiveLinearIssue(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation ArchiveIssue($id: String!) { issueArchive(id: $id) { success } }`,
      variables: { id: ctx.externalId },
    }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Linear', 'archived')
  if (err) return err

  const json = (await response.json()) as {
    data?: { issueArchive?: { success: boolean } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}
