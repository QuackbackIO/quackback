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
