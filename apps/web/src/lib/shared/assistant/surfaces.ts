/**
 * The deploy surfaces the assistant speaks through. Per-surface instructions
 * and guidance-rule scoping key off this union; adding a surface (email, a
 * workflow step) is a new member plus a caller that passes it — no schema
 * change. Client-safe: settings UI renders the catalogue.
 */
export const ASSISTANT_SURFACES = ['widget', 'email', 'workflow_step'] as const

export type AssistantSurface = (typeof ASSISTANT_SURFACES)[number]

/** Admin UI copy for each surface. */
export const ASSISTANT_SURFACE_LABELS: Record<AssistantSurface, { label: string; description: string }> = {
  widget: {
    label: 'Messenger',
    description: 'Conversations started from the widget on your site or app.',
  },
  email: {
    label: 'Email',
    description: 'Conversations arriving through your support email channel.',
  },
  workflow_step: {
    label: 'Workflow step',
    description: 'Answers the assistant gives when a workflow hands it the conversation.',
  },
}
