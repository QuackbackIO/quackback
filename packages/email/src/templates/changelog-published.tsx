import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const CHANGELOG_PUBLISHED_MESSAGES = defineEmailMessages({
  subject: { id: 'email.changelog.subject', defaultMessage: 'New update: {title}' },
  preview: {
    id: 'email.changelog.preview',
    defaultMessage: 'New update from {workspace}: {title}',
  },
  heading: { id: 'email.changelog.heading', defaultMessage: 'New update published' },
  body: {
    id: 'email.changelog.body',
    defaultMessage: '{workspace} just published a product update.',
  },
  cta: { id: 'email.changelog.cta', defaultMessage: 'View update' },
  reason: {
    id: 'email.changelog.reason',
    defaultMessage: "You received this email because you're subscribed to changelog updates.",
  },
  unsubscribe: {
    id: 'email.changelog.unsubscribe',
    defaultMessage: 'Unsubscribe from the changelog',
  },
})
const M = CHANGELOG_PUBLISHED_MESSAGES

interface ChangelogPublishedEmailProps {
  changelogTitle: string
  changelogUrl: string
  contentPreview: string
  /**
   * The entry's full body as pre-rendered, sanitized HTML (from the entry's
   * rich content, or its markdown content rendered the same way). When present
   * it replaces the truncated `contentPreview` excerpt so the reader gets the
   * whole update — formatting and inline images — without leaving their inbox.
   * Absent = fall back to the preview excerpt.
   */
  bodyHtml?: string
  organizationName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
  i18n?: EmailLocale
}

export function ChangelogPublishedEmail({
  changelogTitle,
  changelogUrl,
  contentPreview,
  bodyHtml,
  organizationName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: ChangelogPublishedEmailProps) {
  const { t } = i18n
  return (
    <EmailLayout
      preview={t(M.preview, { workspace: organizationName, title: changelogTitle })}
      logoUrl={logoUrl}
      logoAlt={organizationName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>{t(M.heading)}</Heading>
      <Text style={typography.text}>{t(M.body, { workspace: organizationName })}</Text>

      {/* Changelog Title */}
      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {changelogTitle}
        </Text>
      </Section>

      {/* Full entry body */}
      {bodyHtml ? (
        // Pre-sanitized upstream (write-time TipTap sanitizer + serializer
        // escaping); email clients get no live DOM, so this is the same
        // controlled HTML the app renders server-side.
        <div
          style={{
            color: colors.text,
            fontSize: '16px',
            lineHeight: '26px',
          }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        contentPreview && (
          <Text style={{ ...typography.textSmall, marginTop: '0', marginBottom: '0' }}>
            {contentPreview}
          </Text>
        )
      )}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={changelogUrl}>
          {t(M.cta)}
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason={t(M.reason)}
        unsubscribeUrl={unsubscribeUrl}
        unsubscribeLabel={t(M.unsubscribe)}
        preferencesUrl={preferencesUrl}
        i18n={i18n}
      />
    </EmailLayout>
  )
}
