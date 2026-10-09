import type { IntlShape } from 'react-intl'
import type { NotificationType } from '@/lib/shared/types'
import type { NotificationTextParams } from './text-params'

/** The parts of a notification row its wording depends on. */
export interface NotificationTextSource {
  type: NotificationType
  title: string
  body: string | null
  actorName: string | null
  params?: NotificationTextParams
}

export interface NotificationText {
  title: string
  body: string | null
}

/**
 * A notification's title and body in the reader's language.
 *
 * The server stores both worded in English. For the types a portal user
 * receives, it also sends the values they were worded from (`params`), so the
 * same sentence can be worded again here. A row missing a value it needs (one
 * stored before the value was recorded) and the agent-only types keep their
 * stored text. Bodies that quote user content (comment and message previews)
 * are left as they are.
 */
export function notificationText(n: NotificationTextSource, intl: IntlShape): NotificationText {
  const stored = { title: n.title, body: n.body }
  const p = n.params ?? {}
  const name = n.actorName

  switch (n.type) {
    case 'post_status_changed': {
      if (!p.newStatus) return stored
      return {
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.statusChanged.title',
            defaultMessage: 'Status changed to {status}',
          },
          { status: p.newStatus }
        ),
        body:
          p.postTitle && p.previousStatus
            ? intl.formatMessage(
                {
                  id: 'portal.notifications.text.statusChanged.body',
                  defaultMessage: '"{postTitle}" moved from {previousStatus} to {newStatus}',
                },
                {
                  postTitle: p.postTitle,
                  previousStatus: p.previousStatus,
                  newStatus: p.newStatus,
                }
              )
            : stored.body,
      }
    }
    case 'comment_created':
      if (!name) return stored
      return {
        ...stored,
        title: p.isTeamMember
          ? intl.formatMessage(
              {
                id: 'portal.notifications.text.commentCreated.team',
                defaultMessage: '{name} (team) commented',
              },
              { name }
            )
          : intl.formatMessage(
              {
                id: 'portal.notifications.text.commentCreated',
                defaultMessage: '{name} commented',
              },
              { name }
            ),
      }
    case 'post_mentioned':
      if (!name) return stored
      return {
        ...stored,
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.postMentioned',
            defaultMessage: '{name} mentioned you in a post',
          },
          { name }
        ),
      }
    case 'changelog_published':
      if (!p.changelogTitle) return stored
      return {
        ...stored,
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.changelogPublished',
            defaultMessage: 'New update: {title}',
          },
          { title: p.changelogTitle }
        ),
      }
    case 'status_incident':
      if (!p.incidentTitle || !p.kind) return stored
      return {
        ...stored,
        title:
          p.kind === 'maintenance'
            ? intl.formatMessage(
                {
                  id: 'portal.notifications.text.maintenanceScheduled',
                  defaultMessage: 'Scheduled maintenance: {title}',
                },
                { title: p.incidentTitle }
              )
            : intl.formatMessage(
                {
                  id: 'portal.notifications.text.incidentCreated',
                  defaultMessage: 'New incident: {title}',
                },
                { title: p.incidentTitle }
              ),
      }
    case 'chat_message':
      if (!name) return stored
      return {
        ...stored,
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.chatMessage',
            defaultMessage: 'New message from {name}',
          },
          { name }
        ),
      }
    case 'ticket_status_changed': {
      if (!p.ticketTitle || !p.stageLabel) return stored
      return {
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.ticketStatusChanged.title',
            defaultMessage: '{title} is now {stage}',
          },
          { title: p.ticketTitle, stage: p.stageLabel }
        ),
        body: p.previousStageLabel
          ? intl.formatMessage(
              {
                id: 'portal.notifications.text.ticketStatusChanged.body',
                defaultMessage: 'Moved from {from} to {to}',
              },
              { from: p.previousStageLabel, to: p.stageLabel }
            )
          : intl.formatMessage({
              id: 'portal.notifications.text.ticketStatusChanged.bodyGeneric',
              defaultMessage: 'Open the ticket to see the latest update.',
            }),
      }
    }
    case 'ticket_replied':
      if (!name || !p.ticketTitle) return stored
      return {
        ...stored,
        title: intl.formatMessage(
          {
            id: 'portal.notifications.text.ticketReplied',
            defaultMessage: '{name} replied on {title}',
          },
          { name, title: p.ticketTitle }
        ),
      }
    default:
      return stored
  }
}
