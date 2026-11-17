/**
 * Merge-suggestion tools: accept, dismiss, and restore post-to-post merge
 * suggestions. (The AI feedback-extraction pipeline and its feedback
 * suggestions were removed with the labs subsystem; only merge suggestions
 * remain.)
 */

import { PERMISSIONS } from '@/lib/shared/permissions'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  acceptMergeSuggestion,
  dismissMergeSuggestion,
  getPendingMergeSuggestions,
  restoreMergeSuggestion,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { isTypeId } from '@quackback/ids'
import type { PostId, PostMergeSuggestionId } from '@quackback/ids'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  jsonResult,
  compactJsonResult,
  errorResult,
  READ_ONLY,
  WRITE,
} from './helpers'

/** Validate a merge-suggestion TypeID, owning the shared error message. */
function resolveMergeId(
  id: string
): { ok: true; id: PostMergeSuggestionId } | { ok: false; result: CallToolResult } {
  if (isTypeId(id, 'post_merge_sug')) return { ok: true, id: id as PostMergeSuggestionId }
  return {
    ok: false,
    result: errorResult(new Error('Invalid suggestion ID. Expected post_merge_sug_xxx format.')),
  }
}

const listSuggestionsSchema = {
  sort: z
    .enum(['newest', 'relevance'])
    .optional()
    .describe('Sort order: newest (default) or relevance (highest hybrid score first)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum number of pending suggestions to return (default 50, max 100)'),
  postId: z
    .string()
    .optional()
    .describe('Optional post TypeID (post_xxx) to filter suggestions for a specific post'),
}

const acceptSuggestionSchema = {
  id: z.string().describe('Merge suggestion TypeID (post_merge_sug_xxx)'),
  swapDirection: z.boolean().optional().describe('Swap merge direction (which post is kept)'),
}

const dismissSuggestionSchema = {
  id: z.string().describe('Merge suggestion TypeID to dismiss (post_merge_sug_xxx)'),
}

const restoreSuggestionSchema = {
  id: z
    .string()
    .describe('Merge suggestion TypeID to restore from dismissed to pending (post_merge_sug_xxx)'),
}

type ListSuggestionsArgs = { sort?: 'newest' | 'relevance'; limit?: number; postId?: string }
type AcceptSuggestionArgs = { id: string; swapDirection?: boolean }
type DismissSuggestionArgs = { id: string }
type RestoreSuggestionArgs = { id: string }

export function registerSuggestionTools(server: McpServer, auth: McpAuthContext) {
  registerTool<ListSuggestionsArgs>(server, auth, {
    name: 'list_suggestions',
    permissions: [PERMISSIONS.SUGGESTION_VIEW],
    description: `List pending post-to-post merge suggestions sorted by newest or relevance (hybrid duplicate score). Optionally filter by postId.

Examples:
- List newest pending suggestions: list_suggestions({})
- Filter by relevance for one post: list_suggestions({ postId: "post_01abc...", sort: "relevance", limit: 20 })`,
    schema: listSuggestionsSchema,
    annotations: READ_ONLY,
    scope: 'read:feedback',
    teamOnly: true,
    handler: async (args) => {
      if (args.postId !== undefined && !isTypeId(args.postId, 'post')) {
        return errorResult(new Error('Invalid post ID. Expected post_xxx format.'))
      }
      const limit = args.limit === undefined ? 50 : Math.min(100, Math.max(1, args.limit))
      const result = await getPendingMergeSuggestions({
        sort: args.sort,
        limit,
        postId: args.postId as PostId | undefined,
      })
      return compactJsonResult({ suggestions: result.items, total: result.total })
    },
  })

  registerTool<AcceptSuggestionArgs>(server, auth, {
    name: 'accept_suggestion',
    permissions: [PERMISSIONS.SUGGESTION_MANAGE],
    description: `Accept a post-to-post merge suggestion, merging the source post into the target. Use swapDirection to reverse which post is kept.

Examples:
- Accept merge: accept_suggestion({ id: "post_merge_sug_01abc..." })
- Accept merge swapped: accept_suggestion({ id: "post_merge_sug_01abc...", swapDirection: true })`,
    schema: acceptSuggestionSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const resolved = resolveMergeId(args.id)
      if (!resolved.ok) return resolved.result
      await acceptMergeSuggestion(resolved.id, auth.principalId, {
        swapDirection: args.swapDirection,
      })
      return jsonResult({ accepted: true, id: args.id })
    },
  })

  registerTool<DismissSuggestionArgs>(server, auth, {
    name: 'dismiss_suggestion',
    permissions: [PERMISSIONS.SUGGESTION_MANAGE],
    description: `Dismiss a merge suggestion. It can be restored later via restore_suggestion.

Example: dismiss_suggestion({ id: "post_merge_sug_01abc..." })`,
    schema: dismissSuggestionSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const resolved = resolveMergeId(args.id)
      if (!resolved.ok) return resolved.result
      await dismissMergeSuggestion(resolved.id, auth.principalId)
      return jsonResult({ dismissed: true, id: args.id })
    },
  })

  registerTool<RestoreSuggestionArgs>(server, auth, {
    name: 'restore_suggestion',
    permissions: [PERMISSIONS.SUGGESTION_MANAGE],
    description: `Restore a dismissed merge suggestion back to pending status.

Example: restore_suggestion({ id: "post_merge_sug_01abc..." })`,
    schema: restoreSuggestionSchema,
    annotations: WRITE,
    scope: 'write:feedback',
    teamOnly: true,
    handler: async (args) => {
      const resolved = resolveMergeId(args.id)
      if (!resolved.ok) return resolved.result
      await restoreMergeSuggestion(resolved.id, auth.principalId)
      return jsonResult({ restored: true, id: args.id })
    },
  })
}
