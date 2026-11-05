/**
 * The one-time GitHub star prompt on self-hosted installs: when a team member
 * may be asked. It waits until Quackback is part of their routine, then shows
 * once, as a card after something ships or, failing that, as a row on Home.
 */

export const GITHUB_REPO_URL = 'https://github.com/QuackbackIO/quackback'

export const STAR_PROMPT_MIN_WORKSPACE_AGE_DAYS = 21
export const STAR_PROMPT_MIN_ACTIVE_DAYS = 5
export const STAR_PROMPT_MIN_CUSTOMER_INTERACTIONS = 20
/** After the gates open, how long to wait for a ship moment before Home asks instead. */
export const STAR_PROMPT_HOME_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** 'card' may show after a ship moment; 'home' may also show on Home. */
export type StarPromptStage = 'card' | 'home' | null

export interface StarPromptFacts {
  now: Date
  workspaceCreatedAt: Date | null
  /** When this person reached their fifth active day, or null before then. */
  fifthActiveDayAt: Date | null
  /** Posts, votes and conversations from customers, counted up to the threshold. */
  customerInteractions: number
}

export function starPromptStage(facts: StarPromptFacts): StarPromptStage {
  const { now, workspaceCreatedAt, fifthActiveDayAt, customerInteractions } = facts
  if (!workspaceCreatedAt || !fifthActiveDayAt) return null
  if (customerInteractions < STAR_PROMPT_MIN_CUSTOMER_INTERACTIONS) return null
  const oldEnough = workspaceCreatedAt.getTime() + STAR_PROMPT_MIN_WORKSPACE_AGE_DAYS * DAY_MS
  const opensAt = Math.max(oldEnough, fifthActiveDayAt.getTime())
  if (now.getTime() < opensAt) return null
  return now.getTime() >= opensAt + STAR_PROMPT_HOME_AFTER_DAYS * DAY_MS ? 'home' : 'card'
}
