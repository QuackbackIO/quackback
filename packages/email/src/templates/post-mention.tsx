import { Button, Column, Heading, Row, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { ENGLISH_EMAIL, type EmailLocale } from '../i18n'
import { MENTION_MESSAGES as M } from './note-mention'
import { typography, button, colors } from './shared-styles'

export interface PostMentionEmailProps {
  mentionerName: string
  postTitle: string
  /** Paragraph context for the mention. Empty string suppresses the quote block. */
  excerpt: string
  postUrl: string
  workspaceName: string
  unsubscribeUrl?: string
  preferencesUrl?: string
  logoUrl?: string
  i18n?: EmailLocale
}

export function PostMentionEmail({
  mentionerName,
  postTitle,
  excerpt,
  postUrl,
  workspaceName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: PostMentionEmailProps) {
  const { t } = i18n
  const displayName = mentionerName || t(M.anonymous)
  const hasExcerpt = excerpt.length > 0

  return (
    <EmailLayout
      preview={t(M.postSubject, { name: displayName, post: postTitle })}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>{t(M.postHeading)}</Heading>
      <Text style={typography.text}>{t(M.postBody, { name: displayName, post: postTitle })}</Text>

      {/* Post Title */}
      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '16px',
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
          {t(M.postLabel)}
        </Text>
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {postTitle}
        </Text>
      </Section>

      {/* Excerpt — using Row/Column instead of border-left for Outlook compatibility */}
      {hasExcerpt ? (
        <Row style={{ marginBottom: '24px' }}>
          <Column style={{ width: '3px', backgroundColor: colors.primary, borderRadius: '2px' }} />
          <Column style={{ paddingLeft: '16px' }}>
            <Text
              style={{
                ...typography.text,
                marginTop: '0',
                marginBottom: '0',
                fontStyle: 'italic',
              }}
            >
              &quot;{excerpt}&quot;
            </Text>
          </Column>
        </Row>
      ) : null}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={postUrl}>
          {t(M.viewFeedback)}
        </Button>
      </Section>

      {/* Footer */}
      {unsubscribeUrl ? (
        <NotificationFooter
          reason={t(M.reason, { workspace: workspaceName })}
          unsubscribeUrl={unsubscribeUrl}
          unsubscribeLabel={t(M.turnOff)}
          preferencesUrl={preferencesUrl}
          i18n={i18n}
        />
      ) : (
        <Text style={typography.footer}>{t(M.reason, { workspace: workspaceName })}</Text>
      )}
    </EmailLayout>
  )
}
