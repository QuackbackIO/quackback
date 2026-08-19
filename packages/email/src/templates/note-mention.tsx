import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

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
}: NoteMentionEmailProps) {
  const displayName = authorName || 'A teammate'
  const paragraphs = preview
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <EmailLayout
      preview={`${displayName} mentioned you in an internal note`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      <Heading style={typography.h1}>You were mentioned in a note</Heading>
      <Text style={typography.text}>
        {displayName} mentioned you in an internal note on a conversation.
      </Text>

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

      <Text style={{ ...typography.textSmall, color: colors.textMuted }}>
        Internal notes are visible to your team only.
      </Text>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={conversationUrl}>
          Open conversation
        </Button>
      </Section>

      {preferencesUrl ? (
        <NotificationFooter
          reason={`You received this email because you were mentioned in ${workspaceName}.`}
          unsubscribeUrl={preferencesUrl}
          unsubscribeLabel="Manage notification preferences"
        />
      ) : (
        <Text style={typography.footer}>
          You received this email because you were mentioned in {workspaceName}.
        </Text>
      )}
    </EmailLayout>
  )
}
