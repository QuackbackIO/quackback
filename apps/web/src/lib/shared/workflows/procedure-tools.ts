/**
 * The tools a workflow procedure step may run, for the builder's picker.
 *
 * The runtime accepts a built-in WRITE tool whose `parents` includes
 * 'conversation' and nothing else (workflow-tool-step.ts). That registry lives
 * in server code and carries executors, so it cannot be imported into the
 * builder; this is the hand-maintained view of it the picker reads, held to
 * the registry by procedure-tools.test.ts rather than by a type.
 *
 * `args` names the keys the tool's own input schema declares, in the order the
 * editor should offer them. Values are authored as template strings and
 * interpolated with the same workflow variables a message body uses, then
 * parsed against the tool's zod contract at dispatch.
 */
export interface ProcedureTool {
  /** The tool name the graph node stores, as the registry spells it. */
  name: string
  /** The registry's admin-facing label. */
  label: string
  args: readonly string[]
}

export const PROCEDURE_TOOLS: readonly ProcedureTool[] = [
  { name: 'set_attribute', label: 'Set attribute', args: ['key', 'value'] },
  { name: 'end_conversation', label: 'End conversation', args: ['reason'] },
  {
    name: 'create_ticket',
    label: 'Create ticket',
    args: ['type', 'title', 'description', 'priority'],
  },
  { name: 'capture_contact_details', label: 'Capture contact details', args: ['email', 'name'] },
  { name: 'capture_feedback', label: 'Capture feedback', args: ['boardId', 'title', 'content'] },
  { name: 'share_post', label: 'Share feedback post', args: ['postId'] },
]

/** The picker's label for a stored tool name, falling back to the raw name so
 *  a graph authored against a tool this catalogue has since dropped still
 *  reads as itself rather than as nothing. */
export function procedureToolLabel(name: string): string {
  return PROCEDURE_TOOLS.find((t) => t.name === name)?.label ?? name
}
