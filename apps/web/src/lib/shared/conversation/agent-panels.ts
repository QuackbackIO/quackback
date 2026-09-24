/**
 * The reads beside an open conversation in the agent inbox that the
 * conversation request can load with the thread: the linked customer ticket
 * and the stage labels its status control shows, the contact card with its company, block state and other conversations,
 * Quinn's activity, and the composer's macro, workflow and assignee pickers
 * with the agent's own language preference.
 *
 * Each keeps its own query on the client, refreshed on its own by the
 * mutations that change it. Opening a conversation used to fill them one
 * request each; the thread request now loads the ones whose cache is empty or
 * stale, in the shape each one's own server function returns, and the client
 * seeds each query with its part.
 */
export const AGENT_CONVERSATION_PANELS = [
  'ticketLink',
  'linkedTicket',
  'ticketStageLabels',
  'blockStatus',
  'contact',
  'history',
  'company',
  'assistantActivity',
  'languagePreference',
  'macros',
  'runnableWorkflows',
  'teamMembers',
] as const

export type AgentConversationPanel = (typeof AGENT_CONVERSATION_PANELS)[number]
