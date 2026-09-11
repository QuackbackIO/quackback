/**
 * Map an MCP JSON-RPC request to the capability scope the current operation
 * needs. Used by the OAuth 403 interceptor so clients can step up; API keys
 * never consult this — they keep HTTP 200 + `isError`.
 */
import { getTypeIdPrefix } from '@quackback/ids'
import type { McpScope } from './types'

export const TOOL_SCOPES: Readonly<Record<string, McpScope>> = {
  triage_post: 'write:feedback',
  vote_post: 'write:feedback',
  proxy_vote: 'write:feedback',
  create_post: 'write:feedback',
  merge_post: 'write:feedback',
  unmerge_post: 'write:feedback',
  delete_post: 'write:feedback',
  restore_post: 'write:feedback',
  get_post_activity: 'read:feedback',
  add_comment: 'write:feedback',
  update_comment: 'write:feedback',
  delete_comment: 'write:feedback',
  react_to_comment: 'write:feedback',
  create_changelog: 'write:changelog',
  update_changelog: 'write:changelog',
  delete_changelog: 'write:changelog',
  accept_suggestion: 'write:feedback',
  dismiss_suggestion: 'write:feedback',
  restore_suggestion: 'write:feedback',
  create_article: 'write:article',
  update_article: 'write:article',
  delete_article: 'write:article',
  manage_category: 'write:article',
  list_conversations: 'read:chat',
  get_conversation: 'read:chat',
  reply_to_conversation: 'write:chat',
  suggest_post: 'write:chat',
  share_post: 'write:chat',
  set_conversation_status: 'write:chat',
  list_tickets: 'read:chat',
  get_ticket: 'read:chat',
  create_ticket: 'write:chat',
  reply_to_ticket: 'write:chat',
  add_ticket_note: 'write:chat',
  link_ticket: 'write:chat',
  unlink_ticket: 'write:chat',
}

export const RESOURCE_SCOPES: Readonly<Record<string, McpScope>> = {
  'quackback://boards': 'read:feedback',
  'quackback://statuses': 'read:feedback',
  'quackback://tags': 'read:feedback',
  'quackback://roadmaps': 'read:feedback',
  'quackback://members': 'read:feedback',
  'quackback://help-center/categories': 'read:article',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function searchScope(args: unknown): McpScope {
  const entity = isRecord(args) ? args.entity : undefined
  return entity === 'articles' ? 'read:article' : 'read:feedback'
}

function getDetailsScope(args: unknown): McpScope {
  const id = isRecord(args) && typeof args.id === 'string' ? args.id : null
  if (!id) return 'read:feedback'
  try {
    const prefix = getTypeIdPrefix(id)
    if (prefix === 'article' || prefix === 'kb_article' || prefix === 'kb_category') {
      return 'read:article'
    }
    return 'read:feedback'
  } catch {
    return 'read:feedback'
  }
}

/** Tools that pick a scope from arguments instead of a single `scope:` on registerTool. */
export const MCP_ARGUMENT_DISPATCHED_TOOLS = ['search', 'get_details'] as const

function requiredScopeForOne(body: unknown): McpScope | null {
  if (!isRecord(body) || typeof body.method !== 'string') return null
  const params = isRecord(body.params) ? body.params : {}

  if (body.method === 'tools/call') {
    const name = typeof params.name === 'string' ? params.name : ''
    if (name === 'search') return searchScope(params.arguments)
    if (name === 'get_details') return getDetailsScope(params.arguments)
    return TOOL_SCOPES[name] ?? null
  }

  if (body.method === 'resources/read') {
    const uri = typeof params.uri === 'string' ? params.uri : ''
    return RESOURCE_SCOPES[uri] ?? null
  }

  return null
}

/** Every capability scope this JSON-RPC body (or batch) needs. */
export function requiredScopesForMcpRpc(body: unknown): McpScope[] {
  if (Array.isArray(body)) {
    const scopes: McpScope[] = []
    for (const item of body) scopes.push(...requiredScopesForMcpRpc(item))
    return scopes
  }
  const one = requiredScopeForOne(body)
  return one ? [one] : []
}

export function requiredScopeForMcpRpc(body: unknown): McpScope | null {
  return requiredScopesForMcpRpc(body)[0] ?? null
}
