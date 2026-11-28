import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter, feedbackFooterReason } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const STATUS_CHANGE_MESSAGES = defineEmailMessages({
  headlineAuthor: {
    id: 'email.statusChange.headlineAuthor',
    defaultMessage: 'Your feedback is now {status}!',
  },
  headlineFollower: {
    id: 'email.statusChange.headlineFollower',
    defaultMessage: 'A post you follow is now {status}',
  },
  bodyAuthor: {
    id: 'email.statusChange.bodyAuthor',
    defaultMessage: 'Great news! The status of your feedback has been updated on {workspace}.',
  },
  bodyFollower: {
    id: 'email.statusChange.bodyFollower',
    defaultMessage: 'The status of a post you follow has been updated on {workspace}.',
  },
  cta: { id: 'email.statusChange.cta', defaultMessage: 'View feedback' },
})
const M = STATUS_CHANGE_MESSAGES

/** The heading, which is also the subject line; the status name stays as the team wrote it. */
export function statusChangeHeadline(
  status: string,
  isPostAuthor: boolean,
  i18n: EmailLocale = ENGLISH_EMAIL
): string {
  return i18n.t(isPostAuthor ? M.headlineAuthor : M.headlineFollower, { status })
}

interface StatusChangeEmailProps {
  postTitle: string
  postUrl: string
  previousStatus: string
  newStatus: string
  organizationName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
  /** The reader wrote the post. Everyone else follows it (voted, commented or subscribed). */
  isPostAuthor?: boolean
  i18n?: EmailLocale
}

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    open: '\u{1F4E5}',
    under_review: '\u{1F440}',
    planned: '\u{1F4C5}',
    in_progress: '\u{1F6A7}',
    complete: '\u2705',
    closed: '\u{1F512}',
  }
  return map[status.toLowerCase().replace(/\s+/g, '_')] || '\u{1F4CC}'
}

function capitalizeStatus(status: string): string {
  return status
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function StatusChangeEmail({
  postTitle,
  postUrl,
  previousStatus,
  newStatus,
  organizationName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
  isPostAuthor = false,
  i18n = ENGLISH_EMAIL,
}: StatusChangeEmailProps) {
  const { t } = i18n
  const emoji = getStatusEmoji(newStatus)
  const formattedNewStatus = capitalizeStatus(newStatus)
  const formattedPreviousStatus = capitalizeStatus(previousStatus)
  const headline = statusChangeHeadline(formattedNewStatus, isPostAuthor, i18n)

  return (
    <EmailLayout
      preview={`${emoji} ${headline}`}
      logoUrl={logoUrl}
      logoAlt={organizationName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>{`${emoji} ${headline}`}</Heading>
      <Text style={typography.text}>
        {t(isPostAuthor ? M.bodyAuthor : M.bodyFollower, { workspace: organizationName })}
      </Text>

      {/* Post Title */}
      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {postTitle}
        </Text>
      </Section>

      {/* Status Change */}
      <Text style={typography.text}>
        {formattedPreviousStatus}
        {' \u2192 '}
        <strong>{formattedNewStatus}</strong>
      </Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={postUrl}>
          {t(M.cta)}
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason={feedbackFooterReason(isPostAuthor, i18n)}
        unsubscribeUrl={unsubscribeUrl}
        preferencesUrl={preferencesUrl}
        i18n={i18n}
      />
    </EmailLayout>
  )
}
