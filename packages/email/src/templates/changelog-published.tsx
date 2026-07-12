import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

interface ChangelogPublishedEmailProps {
  changelogTitle: string
  changelogUrl: string
  contentPreview: string
  organizationName: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
}

export function ChangelogPublishedEmail({
  changelogTitle,
  changelogUrl,
  contentPreview,
  organizationName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
}: ChangelogPublishedEmailProps) {
  return (
    <EmailLayout
      preview={`New update from ${organizationName}: ${changelogTitle}`}
      logoUrl={logoUrl}
      logoAlt={organizationName}
    >
      {/* Content */}
      <Heading style={typography.h1}>New update published</Heading>
      <Text style={typography.text}>{organizationName} just published a product update.</Text>

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
        {contentPreview && (
          <Text style={{ ...typography.textSmall, marginTop: '8px', marginBottom: '0' }}>
            {contentPreview}
          </Text>
        )}
      </Section>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={changelogUrl}>
          View Update
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason="You received this email because you're subscribed to changelog updates."
        unsubscribeUrl={unsubscribeUrl}
        preferencesUrl={preferencesUrl}
      />
    </EmailLayout>
  )
}
