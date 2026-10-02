import { Button, Column, Heading, Row, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

interface WelcomeEmailProps {
  name: string
  workspaceName: string
  dashboardUrl: string
  logoUrl?: string
  brandName?: string
}

export function WelcomeEmail({
  name,
  workspaceName,
  dashboardUrl,
  logoUrl,
  brandName = 'Quackback',
}: WelcomeEmailProps) {
  return (
    <EmailLayout
      preview={`Welcome to ${workspaceName} on ${brandName}`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      {/* Content */}
      <Heading style={typography.h1}>Welcome to {brandName}!</Heading>
      <Text style={typography.text}>
        Hi {name}, your workspace <strong>{workspaceName}</strong> is ready. Start collecting and
        managing customer feedback today.
      </Text>

      {/* Features List - using Row/Column instead of spans for email compatibility */}
      <Section style={{ marginBottom: '24px' }}>
        {[
          'Create feedback boards',
          'Invite your team',
          'Share your public roadmap',
          'Connect GitHub, Slack & Discord',
        ].map((feature) => (
          <Row key={feature} style={{ marginBottom: '4px' }}>
            <Column style={{ width: '28px', verticalAlign: 'top' }}>
              <Text style={checkIcon}>&#10003;</Text>
            </Column>
            <Column>
              <Text style={featureText}>{feature}</Text>
            </Column>
          </Row>
        ))}
      </Section>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginBottom: '32px' }}>
        <Button style={button.primary} href={dashboardUrl}>
          Go to Dashboard
        </Button>
      </Section>

      {/* Footer */}
      <TransactionalFooter>
        Happy collecting!
        <br />
        The {brandName} Team
      </TransactionalFooter>
    </EmailLayout>
  )
}

const checkIcon = {
  color: colors.primary,
  fontSize: '15px',
  fontWeight: '700' as const,
  lineHeight: '28px',
  marginTop: '0',
  marginBottom: '0',
}

const featureText = {
  color: colors.text,
  fontSize: '15px',
  lineHeight: '28px',
  marginTop: '0',
  marginBottom: '0',
}
