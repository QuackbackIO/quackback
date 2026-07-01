import { Button, Column, Heading, Row, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

interface ConversationMessageEmailProps {
  heading: string
  intro: string
  senderName: string
  messagePreview: string
  ctaUrl: string
  ctaLabel: string
  organizationName: string
  reason: string
  unsubscribeUrl?: string
  logoUrl?: string
}

export function ConversationMessageEmail({
  heading,
  intro,
  senderName,
  messagePreview,
  ctaUrl,
  ctaLabel,
  organizationName,
  reason,
  unsubscribeUrl,
  logoUrl,
}: ConversationMessageEmailProps) {
  return (
    <EmailLayout preview={heading} logoUrl={logoUrl} logoAlt={organizationName}>
      <Heading style={typography.h1}>{heading}</Heading>
      <Text style={typography.text}>{intro}</Text>

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
          {senderName}
        </Text>
        <Row>
          <Column style={{ width: '3px', backgroundColor: colors.primary, borderRadius: '2px' }} />
          <Column style={{ paddingLeft: '16px' }}>
            <Text
              style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontStyle: 'italic' }}
            >
              &quot;{messagePreview}&quot;
            </Text>
          </Column>
        </Row>
      </Section>

      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={ctaUrl}>
          {ctaLabel}
        </Button>
      </Section>

      <NotificationFooter reason={reason} unsubscribeUrl={unsubscribeUrl ?? ctaUrl} />
    </EmailLayout>
  )
}
