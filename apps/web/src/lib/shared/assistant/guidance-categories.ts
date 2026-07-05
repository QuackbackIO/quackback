/**
 * Guidance-rule categories. Purely a grouping/labeling catalogue for the admin
 * guidance-rules UI (and future prompt-assembly reasoning about rule intent);
 * it does not change how a rule is matched or folded into a prompt. Mirrors
 * Fin's five guidance categories. Client-safe: the settings UI renders the
 * catalogue directly.
 */
export const ASSISTANT_GUIDANCE_CATEGORIES = [
  'communication_style',
  'context_clarification',
  'content_sources',
  'spam',
  'other',
] as const

export type AssistantGuidanceCategory = (typeof ASSISTANT_GUIDANCE_CATEGORIES)[number]

/** Admin UI copy for each category, in catalogue/display order. */
export const ASSISTANT_GUIDANCE_CATEGORY_LABELS: Record<
  AssistantGuidanceCategory,
  { label: string; description: string }
> = {
  communication_style: {
    label: 'Communication style',
    description: 'Tone, voice, and formatting the assistant should use when it replies.',
  },
  context_clarification: {
    label: 'Context and clarification',
    description: 'When to ask a follow-up question instead of guessing what the visitor means.',
  },
  content_sources: {
    label: 'Content and sources',
    description: 'Which sources to trust, cite, or avoid when answering.',
  },
  spam: {
    label: 'Spam',
    description: 'How to recognize and handle spam, abuse, or off-topic messages.',
  },
  other: {
    label: 'Other',
    description: 'Anything that does not fit the categories above.',
  },
}
