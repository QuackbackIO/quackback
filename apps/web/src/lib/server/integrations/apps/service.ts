/**
 * Integration App Service
 *
 * Manages ticket/conversation-to-post links, voting, and lookup operations
 * for integration sidebar apps (Zendesk, Intercom, Freshdesk, etc.).
 * Integration-type agnostic — the integrationType field distinguishes sources.
 */

import {
  db,
  eq,
  and,
  sql,
  posts,
  boards,
  postStatuses,
  postExternalLinks,
} from '@/lib/server/db'
import { createId, fromUuid, type PostId, type PrincipalId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils'
import { addVoteOnBehalf } from '@/lib/server/domains/posts/post.voting'
import { identifyPortalUser } from '@/lib/server/domains/users/user.service'

export interface LinkTicketInput {
  postId: PostId
  integrationType: string
  externalId: string
  externalUrl?: string
  requester?: { email: string; name?: string }
}

export interface LinkTicketResult {
  linkId: string
  voted: boolean
  voteCount: number
  principalId: PrincipalId | null
}

export interface LinkedPost {
  id: string
  title: string
  voteCount: number
  statusName: string | null
  statusColor: string | null
  board: { name: string }
  linkId: string
  linkedAt: Date
}

/**
 * Link an external ticket to a post, optionally voting on behalf of the requester.
 *
 * - Inserts into postExternalLinks (ON CONFLICT = already linked, returns existing)
 * - If requester provided: resolves principal via identifyPortalUser()
 * - Calls addVoteOnBehalf() with source metadata
 */
export async function linkTicketToPost(
  input: LinkTicketInput,
  _actorPrincipalId: PrincipalId
): Promise<LinkTicketResult> {
  const linkId = createId('linked_entity')

  // Insert link (idempotent - ON CONFLICT returns existing)
  const [link] = await db
    .insert(postExternalLinks)
    .values({
      id: linkId,
      postId: input.postId,
      integrationType: input.integrationType,
      externalId: input.externalId,
      externalUrl: input.externalUrl ?? null,
    })
    .onConflictDoNothing({
      target: [
        postExternalLinks.integrationType,
        postExternalLinks.externalId,
        postExternalLinks.postId,
      ],
    })
    .returning({ id: postExternalLinks.id })

  // If conflict, fetch existing link
  const actualLinkId = link?.id ?? (await getExistingLinkId(input))

  // Resolve requester principal and vote on their behalf
  let voterPrincipalId: PrincipalId | null = null
  let voted = false
  let voteCount: number

  if (input.requester?.email) {
    const identified = await identifyPortalUser({
      email: input.requester.email,
      name: input.requester.name,
    })
    voterPrincipalId = identified.principalId

    const voteResult = await addVoteOnBehalf(input.postId, identified.principalId, {
      type: input.integrationType,
      externalUrl: input.externalUrl ?? `${input.integrationType}:${input.externalId}`,
    })
    voted = voteResult.voted
    voteCount = voteResult.voteCount
  } else {
    // No requester - just get current vote count
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, input.postId),
      columns: { voteCount: true },
    })
    voteCount = post?.voteCount ?? 0
  }

  return {
    linkId: actualLinkId ?? linkId,
    voted,
    voteCount,
    principalId: voterPrincipalId,
  }
}

async function getExistingLinkId(input: LinkTicketInput): Promise<string | null> {
  const existing = await db.query.postExternalLinks.findFirst({
    where: and(
      eq(postExternalLinks.integrationType, input.integrationType),
      eq(postExternalLinks.externalId, input.externalId),
      eq(postExternalLinks.postId, input.postId)
    ),
    columns: { id: true },
  })
  return existing?.id ?? null
}

/**
 * Remove a ticket-to-post link. Vote is NOT removed (intentional).
 */
export async function unlinkTicketFromPost(input: {
  postId: PostId
  integrationType: string
  externalId: string
}): Promise<void> {
  await db
    .delete(postExternalLinks)
    .where(
      and(
        eq(postExternalLinks.postId, input.postId),
        eq(postExternalLinks.integrationType, input.integrationType),
        eq(postExternalLinks.externalId, input.externalId)
      )
    )
}

/**
 * Get all posts linked to a specific external ticket.
 */
export async function getLinkedPosts(input: {
  integrationType: string
  externalId: string
}): Promise<LinkedPost[]> {
  const results = await db.execute<{
    id: string
    title: string
    vote_count: number
    status_name: string | null
    status_color: string | null
    board_name: string
    link_id: string
    linked_at: Date | string
  }>(sql`
    SELECT
      p.id,
      p.title,
      p.vote_count,
      ps.name as status_name,
      ps.color as status_color,
      b.name as board_name,
      pel.id as link_id,
      pel.created_at as linked_at
    FROM ${postExternalLinks} pel
    INNER JOIN ${posts} p ON p.id = pel.post_id
    INNER JOIN ${boards} b ON b.id = p.board_id
    LEFT JOIN ${postStatuses} ps ON ps.id = p.status_id
    WHERE pel.integration_type = ${input.integrationType}
      AND pel.external_id = ${input.externalId}
      AND p.deleted_at IS NULL
    ORDER BY pel.created_at DESC
  `)

  return getExecuteRows<{
    id: string
    title: string
    vote_count: number
    status_name: string | null
    status_color: string | null
    board_name: string
    link_id: string
    linked_at: Date | string
  }>(results).map((r) => ({
    id: fromUuid('post', r.id),
    title: r.title,
    voteCount: r.vote_count,
    statusName: r.status_name,
    statusColor: r.status_color,
    board: { name: r.board_name },
    linkId: fromUuid('linked_entity', r.link_id),
    linkedAt: typeof r.linked_at === 'string' ? new Date(r.linked_at) : r.linked_at,
  }))
}
