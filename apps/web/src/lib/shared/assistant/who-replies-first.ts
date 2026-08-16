/**
 * Single source for "who replies first" copy. Rendered on the Agents pages
 * and the Workflows page so the rule is stated once, not in a banner, an
 * office-hours sentence, and a group header independently.
 */
export const WHO_REPLIES_FIRST = {
  titleId: 'automation.whoRepliesFirst.title',
  title: 'Who replies first',
  bodyId: 'automation.whoRepliesFirst.body',
  body: 'When a visitor writes in, the AI agent answers first if it is on and set to reply. Workflows on the same trigger wait their turn.',
  hoursId: 'automation.whoRepliesFirst.officeHours',
  hours: 'Workflows can still be limited to office hours; the agent answers around the clock.',
} as const
