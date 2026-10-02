/** Linear comment creation and linked-issue lookup. */

import type { IntegrationId, PostId } from '@quackback/ids'
import { and, db, eq, inArray, integrationSyncOperations, postExternalLinks } from '@/lib/server/db'
import { issueError } from '@/lib/server/integrations/message-utils'
import { linearGraphql } from './issues'

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id
      }
    }
  }
`

/** Find the active Linear issue this integration linked to a post. */
export async function findLinkedLinearIssueId(
  postId: string,
  integrationId: string
): Promise<string | undefined> {
  const link = await db.query.postExternalLinks.findFirst({
    where: and(
      eq(postExternalLinks.postId, postId as PostId),
      eq(postExternalLinks.integrationId, integrationId as IntegrationId),
      eq(postExternalLinks.integrationType, 'linear'),
      eq(postExternalLinks.status, 'active')
    ),
    columns: { externalId: true },
  })

  return link?.externalId
}

/**
 * Whether this installation is still creating the Linear issue for a post. A
 * comment that arrives in that window has nothing to attach to yet, but will
 * once the create operation lands, so the caller should wait rather than skip.
 */
export async function hasPendingLinearIssueCreate(
  postId: string,
  integrationId: string
): Promise<boolean> {
  const pending = await db.query.integrationSyncOperations.findFirst({
    where: and(
      eq(integrationSyncOperations.integrationId, integrationId as IntegrationId),
      eq(integrationSyncOperations.provider, 'linear'),
      eq(integrationSyncOperations.kind, 'create'),
      eq(integrationSyncOperations.sourceType, 'post'),
      eq(integrationSyncOperations.sourceId, postId),
      inArray(integrationSyncOperations.state, ['queued', 'running', 'retry_wait'])
    ),
    columns: { id: true },
  })
  return !!pending
}

/** Add a Markdown comment to an existing Linear issue and return its id. */
export async function createLinearComment(
  accessToken: string,
  issueId: string,
  body: string
): Promise<string> {
  const result = await linearGraphql(accessToken, CREATE_COMMENT_MUTATION, {
    input: { issueId, body },
  })

  if (result.errors?.length) {
    throw issueError(result.errors[0].message, { retryable: false })
  }
  const created = result.data?.commentCreate as
    { success?: boolean; comment?: { id: string } | null } | undefined
  if (!created?.success || !created.comment) {
    throw issueError('Linear did not create the comment', { retryable: false })
  }

  return created.comment.id
}
