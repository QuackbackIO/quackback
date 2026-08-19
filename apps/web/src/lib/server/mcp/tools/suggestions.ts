/**
 * Merge-suggestion tools: accept, dismiss, and restore post-to-post merge
 * suggestions. (The AI feedback-extraction pipeline and its feedback
 * suggestions were removed with the labs subsystem; only merge suggestions
 * remain.)
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  acceptMergeSuggestion,
  dismissMergeSuggestion,
  restoreMergeSuggestion,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { isTypeId } from '@quackback/ids'
import type { PostMergeSuggestionId } from '@quackback/ids'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpAuthContext } from '../types'
import { registerTool, jsonResult, errorResult, WRITE } from './helpers'

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

type AcceptSuggestionArgs = { id: string; swapDirection?: boolean }
type DismissSuggestionArgs = { id: string }
type RestoreSuggestionArgs = { id: string }

export function registerSuggestionTools(server: McpServer, auth: McpAuthContext) {
  registerTool<AcceptSuggestionArgs>(server, auth, {
    name: 'accept_suggestion',
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
