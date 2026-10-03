/** The private workspace surface never executes a model-requested mutation. */
export const WORKSPACE_THREAD_PREFIX = 'workspace:'

const WORKSPACE_WRITES = new Set([
  'propose_settings_change',
  'create_post',
  'triage_post',
  'vote_post',
  'add_comment',
  'update_comment',
  'react_to_comment',
  'create_article',
  'update_article',
  'manage_category',
  'create_changelog',
  'update_changelog',
  'create_ticket',
  'update_ticket',
  'update_conversation',
  'add_conversation_message',
])

export function isWorkspaceToolAllowed(name: string, risk: string): boolean {
  if (risk !== 'write')
    return !/(delete|remove|install|oauth|billing|member|api_key|domain|sso)/i.test(name)
  return name === 'propose_settings_change'
}

export function isWorkspaceMutationAllowed(name: string, args: unknown): boolean {
  if (!WORKSPACE_WRITES.has(name)) return false
  const prohibited = new Set(['delete', 'remove', 'archive', 'destroy', 'purge', 'revoke'])
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return true
    for (const [key, item] of Object.entries(value)) {
      if (/^(deletedAt|deleted_at|delete|remove|archive|archivedAt|purge)$/i.test(key)) return false
      if (
        /^(action|operation|op|status)$/i.test(key) &&
        typeof item === 'string' &&
        prohibited.has(item.toLowerCase())
      )
        return false
      if (!visit(item)) return false
    }
    return true
  }
  return visit(args)
}

export function workspaceProposalMode(input: {
  role: string
  workspaceThreadKey?: string
  risk: string
  approvalPolicy?: string
}): 'propose' | null {
  return input.role === 'workspace_assistant' &&
    input.workspaceThreadKey?.startsWith(WORKSPACE_THREAD_PREFIX) &&
    input.risk === 'write'
    ? 'propose'
    : null
}
