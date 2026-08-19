/**
 * Comment tools: create, edit, delete, and emoji reactions.
 *
 * None of these declare `teamOnly` — the service layer allows comment authors
 * OR team members, and the edit/delete paths view-gate first so an author who
 * can no longer view the board cannot touch the comment.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createComment, deleteComment } from '@/lib/server/domains/comments/comment.service'
import { userEditComment } from '@/lib/server/domains/comments/comment.permissions'
import { addReaction, removeReaction } from '@/lib/server/domains/comments/comment.reactions'
import type { PostId, PostCommentId } from '@quackback/ids'
import type { McpAuthContext } from '../types'
import { registerTool, mcpMemberActor, jsonResult, WRITE, DESTRUCTIVE } from './helpers'

// ============================================================================
// Schemas
// ============================================================================

/** Shared tail for the comment content `.describe()` blurbs. */
const COMMENT_PLAIN_TEXT_DESCRIBE =
  'Plain text only (max 5,000 characters). Rich content, markdown, and image embedding are not supported for comments today.'

const addCommentSchema = {
  postId: z.string().describe('Post TypeID to comment on'),
  content: z.string().max(5000).describe(`Comment text. ${COMMENT_PLAIN_TEXT_DESCRIBE}`),
  parentId: z.string().optional().describe('Parent comment TypeID for threaded reply'),
  isPrivate: z
    .boolean()
    .optional()
    .describe('If true, comment is an internal note visible only to team members'),
}

const updateCommentSchema = {
  commentId: z.string().describe('Comment TypeID to edit'),
  content: z.string().max(5000).describe(`New comment text. ${COMMENT_PLAIN_TEXT_DESCRIBE}`),
}

const deleteCommentSchema = {
  commentId: z.string().describe('Comment TypeID to delete'),
}

const reactToCommentSchema = {
  action: z.enum(['add', 'remove']).describe('Whether to add or remove the reaction'),
  commentId: z.string().describe('Comment TypeID to react to'),
  emoji: z.string().max(32).describe('Emoji to react with (e.g., "👍", "❤️", "🎉")'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type AddCommentArgs = {
  postId: string
  content: string
  parentId?: string
  isPrivate?: boolean
}

type UpdateCommentArgs = {
  commentId: string
  content: string
}

type DeleteCommentArgs = { commentId: string }

type ReactToCommentArgs = {
  action: 'add' | 'remove'
  commentId: string
  emoji: string
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerCommentTools(server: McpServer, auth: McpAuthContext) {
  registerTool<AddCommentArgs>(server, auth, {
    name: 'add_comment',
    description: `Post a comment on a feedback post. Supports threaded replies via parentId. Set isPrivate to create an internal note visible only to team members.

Examples:
- Top-level comment: add_comment({ postId: "post_01abc...", content: "Thanks for the feedback!" })
- Threaded reply: add_comment({ postId: "post_01abc...", content: "Good point.", parentId: "post_comment_01xyz..." })
- Internal note: add_comment({ postId: "post_01abc...", content: "Discussed in standup, prioritizing for Q3.", isPrivate: true })`,
    schema: addCommentSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    handler: async (args) => {
      // The actor carries the caller's REAL role so the policy gate inside
      // createComment reflects who is doing the write.
      const result = await createComment(
        {
          postId: args.postId as PostId,
          content: args.content,
          parentId: args.parentId as PostCommentId | undefined,
          isPrivate: args.isPrivate,
        },
        {
          principalId: auth.principalId,
          userId: auth.userId,
          name: auth.name,
          email: auth.email,
          displayName: auth.name,
          role: auth.role,
        },
        await mcpMemberActor(auth)
      )

      return jsonResult({
        id: result.comment.id,
        postId: result.comment.postId,
        content: result.comment.content,
        parentId: result.comment.parentId,
        isPrivate: result.comment.isPrivate,
        isTeamMember: result.comment.isTeamMember,
        createdAt: result.comment.createdAt,
      })
    },
  })

  registerTool<UpdateCommentArgs>(server, auth, {
    name: 'update_comment',
    description: `Edit a comment's content. Team members can edit any comment; authors can edit their own.

Examples:
- Edit: update_comment({ commentId: "post_comment_01abc...", content: "Updated feedback response." })`,
    schema: updateCommentSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    // No team role gate — the service layer allows comment authors OR team members
    handler: async (args) => {
      // View-gate first: an author who can no longer view the comment's
      // board (tightened to team / dropped from a segment) must not edit
      // it via MCP, matching the portal path (functions/comments.ts).
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      await assertCommentViewable(args.commentId as PostCommentId, await mcpMemberActor(auth))
      const result = await userEditComment(args.commentId as PostCommentId, args.content, {
        principalId: auth.principalId,
        role: auth.role,
      })

      return jsonResult({
        id: result.id,
        postId: result.postId,
        content: result.content,
      })
    },
  })

  registerTool<DeleteCommentArgs>(server, auth, {
    name: 'delete_comment',
    description: `Hard-delete a comment and all its replies (cascade). This cannot be undone.
Authors can delete their own comments; team members can delete any comment.

Examples:
- Delete: delete_comment({ commentId: "post_comment_01abc..." })`,
    schema: deleteCommentSchema,
    annotations: DESTRUCTIVE,
    scope: 'write:feedback',
    // No team role gate — the service layer allows comment authors OR team members
    handler: async (args) => {
      // View-gate before the irreversible cascade delete — same as the
      // portal path and react_to_comment.
      const { assertCommentViewable } = await import('@/lib/server/domains/posts/post.access')
      await assertCommentViewable(args.commentId as PostCommentId, await mcpMemberActor(auth))
      await deleteComment(args.commentId as PostCommentId, {
        principalId: auth.principalId,
        role: auth.role,
      })

      return jsonResult({ deleted: true, commentId: args.commentId })
    },
  })

  registerTool<ReactToCommentArgs>(server, auth, {
    name: 'react_to_comment',
    description: `Add or remove an emoji reaction on a comment.

Examples:
- Add reaction: react_to_comment({ action: "add", commentId: "post_comment_01abc...", emoji: "👍" })
- Remove reaction: react_to_comment({ action: "remove", commentId: "post_comment_01abc...", emoji: "👍" })`,
    schema: reactToCommentSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    handler: async (args) => {
      // The actor reflects who is reacting, for the canViewPost + isPrivate
      // gates inside add/removeReaction.
      const reactionActor = await mcpMemberActor(auth)
      const result =
        args.action === 'add'
          ? await addReaction(
              args.commentId as PostCommentId,
              args.emoji,
              auth.principalId,
              reactionActor
            )
          : await removeReaction(
              args.commentId as PostCommentId,
              args.emoji,
              auth.principalId,
              reactionActor
            )

      return jsonResult({
        commentId: args.commentId,
        emoji: args.emoji,
        added: result.added,
        reactions: result.reactions,
      })
    },
  })
}
