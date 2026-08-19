/**
 * Post tools: triage, votes (own + proxy), create, lifecycle (delete/restore),
 * merge/unmerge, and the activity log.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createPost, updatePost } from '@/lib/server/domains/posts/post.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { voteOnPost, addVoteOnBehalf, removeVote } from '@/lib/server/domains/posts/post.voting'
import { mergePost, unmergePost } from '@/lib/server/domains/posts/post.merge'
import { softDeletePost, restorePost } from '@/lib/server/domains/posts/post.user-actions'
import { getActivityForPost, createActivity } from '@/lib/server/domains/activity/activity.service'
import type { PostId, BoardId, PostTagId, PostStatusId, PrincipalId } from '@quackback/ids'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  mcpMemberActor,
  jsonResult,
  READ_ONLY,
  WRITE,
  DESTRUCTIVE,
  CONTENT_FORMAT_BLOCK,
  CONTENT_FIELD_DESCRIBE,
} from './helpers'

// ============================================================================
// Schemas
// ============================================================================

const triagePostSchema = {
  postId: z.string().describe('Post TypeID to update'),
  statusId: z.string().optional().describe('New status TypeID'),
  tagIds: z.array(z.string()).optional().describe('Replace all tags with these TypeIDs'),
  ownerPrincipalId: z
    .string()
    .nullable()
    .optional()
    .describe('Assign to member TypeID, or null to unassign'),
}

const createPostSchema = {
  boardId: z.string().describe('Board TypeID (use quackback://boards resource to find IDs)'),
  title: z.string().max(200).describe('Post title (max 200 characters)'),
  content: z
    .string()
    .max(10000)
    .optional()
    .describe(`Post content (max 10,000 characters). ${CONTENT_FIELD_DESCRIBE}`),
  statusId: z.string().optional().describe('Initial status TypeID (defaults to board default)'),
  tagIds: z.array(z.string()).optional().describe('PostTag TypeIDs to apply'),
}

const votePostSchema = {
  postId: z.string().describe('Post TypeID to vote on'),
}

const proxyVoteSchema = {
  action: z
    .enum(['add', 'remove'])
    .default('add')
    .describe('Whether to add or remove the proxy vote'),
  postId: z.string().describe('Post TypeID to vote on'),
  voterPrincipalId: z.string().describe('Principal TypeID of the user to vote on behalf of'),
  sourceType: z.string().optional().describe('Attribution source type (e.g. "zendesk", "slack")'),
  sourceExternalUrl: z.string().optional().describe('URL linking to the originating record'),
}

const mergePostSchema = {
  duplicatePostId: z.string().describe('Post TypeID of the duplicate to merge away'),
  canonicalPostId: z.string().describe('Post TypeID of the canonical post to merge into'),
}

const unmergePostSchema = {
  postId: z.string().describe('Post TypeID of the merged post to restore'),
}

const deletePostSchema = {
  postId: z.string().describe('Post TypeID to delete'),
}

const restorePostSchema = {
  postId: z.string().describe('Post TypeID to restore'),
}

const getPostActivitySchema = {
  postId: z.string().describe('Post TypeID to get activity for'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type TriagePostArgs = {
  postId: string
  statusId?: string
  tagIds?: string[]
  ownerPrincipalId?: string | null
}

type CreatePostArgs = {
  boardId: string
  title: string
  content?: string
  statusId?: string
  tagIds?: string[]
}

type VotePostArgs = { postId: string }

type ProxyVoteArgs = {
  action: 'add' | 'remove'
  postId: string
  voterPrincipalId: string
  sourceType?: string
  sourceExternalUrl?: string
}

type MergePostArgs = {
  duplicatePostId: string
  canonicalPostId: string
}

type UnmergePostArgs = { postId: string }

type DeletePostArgs = { postId: string }

type RestorePostArgs = { postId: string }

type GetPostActivityArgs = { postId: string }

// ============================================================================
// Tool registration
// ============================================================================

export function registerPostTools(server: McpServer, auth: McpAuthContext) {
  registerTool<TriagePostArgs>(server, auth, {
    name: 'triage_post',
    description: `Update a post: set status, tags, and/or owner. All fields optional — only provided fields are updated.

Examples:
- Change status: triage_post({ postId: "post_01abc...", statusId: "post_status_01xyz..." })
- Assign owner: triage_post({ postId: "post_01abc...", ownerPrincipalId: "principal_01xyz..." })
- Replace tags: triage_post({ postId: "post_01abc...", tagIds: ["tag_01a...", "tag_01b..."] })`,
    schema: triagePostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const result = await updatePost(
        args.postId as PostId,
        {
          statusId: args.statusId as PostStatusId | undefined,
          tagIds: args.tagIds as PostTagId[] | undefined,
          ownerPrincipalId: args.ownerPrincipalId as PrincipalId | null | undefined,
        },
        {
          principalId: auth.principalId,
          userId: auth.userId,
          email: auth.email,
          displayName: auth.name,
        }
      )

      return jsonResult({
        id: result.id,
        title: result.title,
        statusId: result.statusId,
        ownerPrincipalId: result.ownerPrincipalId,
        updatedAt: result.updatedAt,
      })
    },
  })

  registerTool<VotePostArgs>(server, auth, {
    name: 'vote_post',
    description: `Toggle vote on a feedback post. If not yet voted, adds a vote. If already voted, removes the vote.

Examples:
- Vote on a post: vote_post({ postId: "post_01abc..." })
- Unvote (call again): vote_post({ postId: "post_01abc..." })`,
    schema: votePostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    handler: async (args) => {
      // Chokepoint: resolves the post + board, then runs canVotePost
      // (which composes canViewPost). Team API keys always pass the
      // tier check; this primarily enforces post.deletedAt /
      // board.deletedAt + per-board vote tier — protections that
      // voteOnPost alone skipped.
      const { assertPostVotable } = await import('@/lib/server/domains/posts/post.access')
      const votingActor = {
        principalId: auth.principalId,
        role: auth.role,
        principalType: 'user' as const,
        segmentIds: await segmentIdsForPrincipal(auth.principalId),
      }
      await assertPostVotable(args.postId as PostId, votingActor)
      const result = await voteOnPost(args.postId as PostId, auth.principalId)

      return jsonResult({
        postId: args.postId,
        voted: result.voted,
        voteCount: result.voteCount,
      })
    },
  })

  registerTool<ProxyVoteArgs>(server, auth, {
    name: 'proxy_vote',
    description: `Add or remove a vote on behalf of another user. Requires team role.

Examples:
- Add proxy vote: proxy_vote({ postId: "post_01abc...", voterPrincipalId: "principal_01xyz..." })
- Add with attribution: proxy_vote({ postId: "post_01abc...", voterPrincipalId: "principal_01xyz...", sourceType: "zendesk", sourceExternalUrl: "https://..." })
- Remove vote: proxy_vote({ action: "remove", postId: "post_01abc...", voterPrincipalId: "principal_01xyz..." })`,
    schema: proxyVoteSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      // Team-authority tool: records a vote on behalf of `voterPrincipalId`
      // (e.g. from a support ticket). It routes to addVoteOnBehalf and
      // deliberately does NOT run assertPostVotable — the per-board vote
      // tier gates a user voting for THEMSELVES, not a teammate attributing
      // signal gathered off-portal. Enforcing the target's tier would defeat
      // the feature (e.g. logging customer demand on a vote='team' roadmap).
      // Pinned by handler.test.ts "intentional team-attributed bypass".
      if (args.action === 'remove') {
        const result = await removeVote(args.postId as PostId, args.voterPrincipalId as PrincipalId)
        if (result.removed) {
          createActivity({
            postId: args.postId as PostId,
            principalId: auth.principalId,
            type: 'vote.removed',
            metadata: { voterPrincipalId: args.voterPrincipalId },
          })
        }
        return jsonResult({
          postId: args.postId,
          voterPrincipalId: args.voterPrincipalId,
          removed: result.removed,
          voteCount: result.voteCount,
        })
      }

      const source = args.sourceType
        ? { type: args.sourceType, externalUrl: args.sourceExternalUrl ?? '' }
        : { type: 'proxy', externalUrl: '' }

      const result = await addVoteOnBehalf(
        args.postId as PostId,
        args.voterPrincipalId as PrincipalId,
        source,
        auth.principalId
      )
      if (result.voted) {
        createActivity({
          postId: args.postId as PostId,
          principalId: auth.principalId,
          type: 'vote.proxy',
          metadata: { voterPrincipalId: args.voterPrincipalId },
        })
      }
      return jsonResult({
        postId: args.postId,
        voterPrincipalId: args.voterPrincipalId,
        voted: result.voted,
        voteCount: result.voteCount,
      })
    },
  })

  registerTool<CreatePostArgs>(server, auth, {
    name: 'create_post',
    description: `Submit new feedback on a board. Requires board and title; content/status/tags optional.

Examples:
- Minimal: create_post({ boardId: "board_01abc...", title: "Add dark mode" })
- Full: create_post({ boardId: "board_01abc...", title: "Add dark mode", content: "Would love a dark theme option.", statusId: "post_status_01xyz...", tagIds: ["tag_01a..."] })${CONTENT_FORMAT_BLOCK}`,
    schema: createPostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    handler: async (args) => {
      // The actor carries the caller's REAL role so the policy gate inside
      // createPost (submit tier + moderation axis) reflects who is writing.
      const actor = await mcpMemberActor(auth)

      const result = await createPost(
        {
          boardId: args.boardId as BoardId,
          title: args.title,
          content: args.content ?? '',
          statusId: args.statusId as PostStatusId | undefined,
          tagIds: args.tagIds as PostTagId[] | undefined,
        },
        {
          principalId: auth.principalId,
          userId: auth.userId,
          name: auth.name,
          email: auth.email,
          displayName: auth.name,
          actor,
        }
      )

      return jsonResult({
        id: result.id,
        title: result.title,
        boardId: result.boardId,
        statusId: result.statusId,
        createdAt: result.createdAt,
      })
    },
  })

  registerTool<MergePostArgs>(server, auth, {
    name: 'merge_post',
    description: `Merge a duplicate post into a canonical post. Aggregates votes. Reversible via unmerge_post.

Examples:
- Merge: merge_post({ duplicatePostId: "post_01dup...", canonicalPostId: "post_01canon..." })`,
    schema: mergePostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const result = await mergePost(
        args.duplicatePostId as PostId,
        args.canonicalPostId as PostId,
        auth.principalId
      )

      return jsonResult({
        canonicalPost: result.canonicalPost,
        duplicatePost: result.duplicatePost,
      })
    },
  })

  registerTool<UnmergePostArgs>(server, auth, {
    name: 'unmerge_post',
    description: `Restore a merged post to independent state. Recalculates vote counts.

Examples:
- Unmerge: unmerge_post({ postId: "post_01merged..." })`,
    schema: unmergePostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const result = await unmergePost(args.postId as PostId, auth.principalId)

      return jsonResult({
        post: result.post,
        canonicalPost: result.canonicalPost,
      })
    },
  })

  registerTool<DeletePostArgs>(server, auth, {
    name: 'delete_post',
    description: `Soft-delete a feedback post. The post is hidden from public views but can be restored within 30 days.

Examples:
- Delete: delete_post({ postId: "post_01abc..." })`,
    schema: deletePostSchema,
    annotations: DESTRUCTIVE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      await softDeletePost(args.postId as PostId, {
        principalId: auth.principalId,
        role: auth.role,
      })

      return jsonResult({ deleted: true, postId: args.postId })
    },
  })

  registerTool<RestorePostArgs>(server, auth, {
    name: 'restore_post',
    description: `Restore a soft-deleted post. Posts can only be restored within 30 days of deletion.

Examples:
- Restore: restore_post({ postId: "post_01abc..." })`,
    schema: restorePostSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const result = await restorePost(args.postId as PostId, auth.principalId)

      return jsonResult({ restored: true, postId: args.postId, title: result.title })
    },
  })

  registerTool<GetPostActivityArgs>(server, auth, {
    name: 'get_post_activity',
    description: `Get the activity log for a post. Shows status changes, merges, tag changes, owner assignments, proxy votes, and other events.

Examples:
- Get activity: get_post_activity({ postId: "post_01abc..." })`,
    schema: getPostActivitySchema,
    annotations: READ_ONLY,
    scope: 'read:feedback',
    teamOnly: true,
    handler: async (args) => {
      const activities = await getActivityForPost(args.postId as PostId)

      return jsonResult({
        postId: args.postId,
        activities: activities.map((a) => ({
          id: a.id,
          type: a.type,
          actorName: a.actorName,
          metadata: a.metadata,
          createdAt: a.createdAt,
        })),
      })
    },
  })
}
