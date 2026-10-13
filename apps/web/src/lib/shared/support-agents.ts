/**
 * Who answers customers: the vocabulary shared by the server and the admin UI.
 *
 * The workspace picks one answerer for Messenger conversations: the built-in
 * AI, its own AI agent, or its team. Every conversation has one controller at
 * a time, and an AI agent only writes to conversations it controls.
 */

export const ANSWER_MODES = ['quackback_ai', 'own_agent', 'team'] as const
export type AnswerMode = (typeof ANSWER_MODES)[number]

/** Prefix of an agent's own credential. It is never a teammate's API key. */
export const AGENT_CREDENTIAL_PREFIX = 'qba_'

export const AGENT_DEADLINE_DEFAULT_SECONDS = 20
export const AGENT_DEADLINE_MIN_SECONDS = 5
export const AGENT_DEADLINE_MAX_SECONDS = 120

/** What the agent can show while it works. Same vocabulary as the built-in AI. */
export const AGENT_ACTIVITY_STATUSES = [
  'thinking',
  'searching_kb',
  'reviewing_conversation',
] as const
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number]

/** Longest reply, matching what a customer or teammate can send. */
export const AGENT_MAX_REPLY_LENGTH = 4000
