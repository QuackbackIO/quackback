/**
 * The v1 dynamic-variable catalogue for workflow message blocks: the tokens
 * `resolveWorkflowVariables` (server) populates and the block editor's
 * insert-variable menu (client) offers. Client-safe (no db imports) so both
 * sides draw from one list: a new token added here appears in both places
 * at once, mirroring the existing macro-variable pattern
 * (`@/lib/shared/conversation/macros`).
 */
export const WORKFLOW_VARIABLE_CATALOGUE = [
  { key: 'first_name', label: 'First name' },
  { key: 'name', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'workspace_name', label: 'Workspace name' },
] as const

export type WorkflowVariableKey = (typeof WORKFLOW_VARIABLE_CATALOGUE)[number]['key']
