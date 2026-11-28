/**
 * The tools the MCP server registers, by name. The server types its tool
 * registry against this list (McpToolName, UNTRUSTED_TOOL_FIELDS) and a test
 * holds it equal to what the server registers, so the admin setup guide can
 * show it without a copy of its own.
 */
export const MCP_TOOL_NAMES = [
  'search',
  'get_details',
  'triage_post',
  'vote_post',
  'proxy_vote',
  'create_post',
  'merge_post',
  'unmerge_post',
  'delete_post',
  'restore_post',
  'get_post_activity',
  'add_comment',
  'update_comment',
  'delete_comment',
  'react_to_comment',
  'create_changelog',
  'update_changelog',
  'delete_changelog',
  'accept_suggestion',
  'dismiss_suggestion',
  'restore_suggestion',
  'create_article',
  'update_article',
  'delete_article',
  'manage_category',
  'translate_article',
  'list_conversations',
  'get_conversation',
  'reply_to_conversation',
  'suggest_post',
  'share_post',
  'set_conversation_status',
  'list_tickets',
  'get_ticket',
  'create_ticket',
  'reply_to_ticket',
  'add_ticket_note',
  'link_ticket',
  'unlink_ticket',
  'upload_file',
  'widget_install_status',
  'get_settings',
  'update_settings',
  'navigate_workspace',
] as const

export type McpToolName = (typeof MCP_TOOL_NAMES)[number]
