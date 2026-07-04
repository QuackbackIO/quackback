/**
 * MCP Tools for Quackback
 *
 * 35 tools calling domain services directly (no HTTP self-loop), grouped by
 * resource module. Each tool declares its authorization contract — `{ scope,
 * teamOnly, feature }` — on `registerTool` (see ./helpers), except the two
 * cross-entity lookup tools (search, get_details) which gate per-branch.
 *
 * - search.ts        search, get_details
 * - posts.ts         triage_post, vote_post, proxy_vote, create_post,
 *                    merge_post, unmerge_post, delete_post, restore_post,
 *                    get_post_activity
 * - comments.ts      add_comment, update_comment, delete_comment,
 *                    react_to_comment
 * - changelog.ts     create_changelog, update_changelog, delete_changelog
 * - roadmaps.ts      manage_roadmap_post
 * - suggestions.ts   list_suggestions, accept_suggestion, dismiss_suggestion,
 *                    restore_suggestion
 * - help-center.ts   create_article, update_article, delete_article,
 *                    manage_category
 * - conversations.ts list_conversations, get_conversation,
 *                    reply_to_conversation, suggest_post, share_post,
 *                    set_conversation_status
 * - tickets.ts       list_tickets, get_ticket
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpAuthContext } from '../types'
import { registerSearchTools } from './search'
import { registerPostTools } from './posts'
import { registerCommentTools } from './comments'
import { registerChangelogTools } from './changelog'
import { registerRoadmapTools } from './roadmaps'
import { registerSuggestionTools } from './suggestions'
import { registerHelpCenterTools } from './help-center'
import { registerConversationTools } from './conversations'
import { registerTicketTools } from './tickets'

export function registerTools(server: McpServer, auth: McpAuthContext) {
  registerSearchTools(server, auth)
  registerPostTools(server, auth)
  registerCommentTools(server, auth)
  registerChangelogTools(server, auth)
  registerRoadmapTools(server, auth)
  registerSuggestionTools(server, auth)
  registerHelpCenterTools(server, auth)
  registerConversationTools(server, auth)
  registerTicketTools(server, auth)
}
