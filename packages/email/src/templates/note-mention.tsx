import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, LAYOUT_MESSAGES, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const MENTION_MESSAGES = defineEmailMessages({
  someone: { id: 'email.mention.someone', defaultMessage: 'A teammate' },
  anonymous: { id: 'email.mention.anonymous', defaultMessage: 'Anonymous user' },
  preview: {
    id: 'email.mention.notePreview',
    defaultMessage: '{name} mentioned you in an internal note',
  },
  heading: { id: 'email.mention.noteHeading', defaultMessage: 'You were mentioned in a note' },
  body: {
    id: 'email.mention.noteBody',
    defaultMessage: '{name} mentioned you in an internal note on a conversation.',
  },
  internal: {
    id: 'email.mention.internal',
    defaultMessage: 'Internal notes are visible to your team only.',
  },
  cta: { id: 'email.mention.openConversation', defaultMessage: 'Open conversation' },
  reason: {
    id: 'email.mention.reason',
    defaultMessage: 'You received this email because you were mentioned in {workspace}.',
  },
  postSubject: {
    id: 'email.mention.postSubject',
    defaultMessage: '{name} mentioned you in "{post}"',
  },
  postHeading: { id: 'email.mention.postHeading', defaultMessage: 'You were mentioned' },
  postBody: { id: 'email.mention.postBody', defaultMessage: '{name} mentioned you in {post}.' },
  postLabel: { id: 'email.newComment.postLabel', defaultMessage: 'Feedback' },
  viewFeedback: { id: 'email.statusChange.cta', defaultMessage: 'View feedback' },
  turnOff: { id: 'email.mention.turnOff', defaultMessage: 'Turn off all email' },
})
const M = MENTION_MESSAGES

export interface NoteMentionEmailProps {
  /** Teammate who wrote the note. */
  authorName: string
  /** Plain-text note preview. Empty string suppresses the quote block. */
  preview: string
  /** Admin inbox deep link — the note is internal, so this is never a portal URL. */
  conversationUrl: string
  workspaceName: string
  preferencesUrl?: string
  logoUrl?: string
  i18n?: EmailLocale
}

/**
 * Alert for a teammate @-mentioned in an internal note on a conversation.
 *
 * Agent-facing, so there is no unsubscribe token: the only opt-out is the
 * notification-preferences surface, and the footer links straight to it.
 */
export function NoteMentionEmail({
  authorName,
  preview,
  conversationUrl,
  workspaceName,
  preferencesUrl,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: NoteMentionEmailProps) {
  const { t } = i18n
  const displayName = authorName || t(M.someone)
  const paragraphs = preview
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <EmailLayout
      preview={t(M.preview, { name: displayName })}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
      i18n={i18n}
    >
      <Heading style={typography.h1}>{t(M.heading)}</Heading>
      <Text style={typography.text}>{t(M.body, { name: displayName })}</Text>

      {paragraphs.length > 0 && (
        <Section
          style={{
            backgroundColor: colors.surfaceMuted,
            borderRadius: '8px',
            padding: '16px 20px',
            marginBottom: '16px',
            borderLeft: `3px solid ${colors.primary}`,
          }}
        >
          <Text
            style={{
              ...typography.textSmall,
              marginTop: '0',
              marginBottom: '4px',
              color: colors.textMuted,
            }}
          >
            {displayName}
          </Text>
          {paragraphs.map((p, i) => (
            <Text
              key={i}
              style={{ ...typography.text, marginTop: i === 0 ? '0' : '8px', marginBottom: '0' }}
            >
              {p}
            </Text>
          ))}
        </Section>
      )}

      <Text style={{ ...typography.textSmall, color: colors.textMuted }}>{t(M.internal)}</Text>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={conversationUrl}>
          {t(M.cta)}
        </Button>
      </Section>

      {preferencesUrl ? (
        <NotificationFooter
          reason={t(M.reason, { workspace: workspaceName })}
          unsubscribeUrl={preferencesUrl}
          unsubscribeLabel={t(LAYOUT_MESSAGES.preferences)}
          i18n={i18n}
        />
      ) : (
        <Text style={typography.footer}>{t(M.reason, { workspace: workspaceName })}</Text>
      )}
    </EmailLayout>
  )
}
