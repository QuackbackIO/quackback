/**
 * Metadata values a notification's English title and body were worded from.
 * The server sends them with each row so the bell can word the row again in
 * the reader's language (see `notification-text.ts`); a row without the values
 * it needs keeps its stored text.
 */
export interface NotificationTextParams {
  postTitle?: string
  previousStatus?: string
  newStatus?: string
  changelogTitle?: string
  incidentTitle?: string
  /** Status notifications: 'incident' or 'maintenance'. */
  kind?: string
  ticketTitle?: string
  stageLabel?: string
  previousStageLabel?: string
  isTeamMember?: boolean
}

const TEXT_PARAM_KEYS = [
  'postTitle',
  'previousStatus',
  'newStatus',
  'changelogTitle',
  'incidentTitle',
  'kind',
  'ticketTitle',
  'stageLabel',
  'previousStageLabel',
] as const

/**
 * The metadata values a notification's title and body were worded from, so
 * the bell can word them again in the reader's language. Only strings pass;
 * `isTeamMember` is the one flag a title depends on.
 */
export function notificationTextParams(
  metadata: Record<string, unknown> | null | undefined
): NotificationTextParams {
  const params: NotificationTextParams = {}
  if (!metadata) return params
  for (const key of TEXT_PARAM_KEYS) {
    const value = metadata[key]
    if (typeof value === 'string') params[key] = value
  }
  if (metadata.isTeamMember === true) params.isTeamMember = true
  return params
}
