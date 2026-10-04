import { Button, Column, Heading, Link, Row, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors, utils } from './shared-styles'

export interface OnboardingEmailStep {
  title: string
  outcome: string
  url: string
}

interface OnboardingWelcomeEmailProps {
  name: string
  workspaceName: string
  steps: OnboardingEmailStep[]
  homeUrl: string
  unsubscribeUrl: string
  logoUrl?: string
}

/** Sent once, when a new workspace's owner first lands: their three steps to a first result. */
export function OnboardingWelcomeEmail({
  name,
  workspaceName,
  steps,
  homeUrl,
  unsubscribeUrl,
  logoUrl,
}: OnboardingWelcomeEmailProps) {
  return (
    <EmailLayout
      preview={`${workspaceName} is ready. Here are your next steps.`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      <Heading style={typography.h1}>{workspaceName} is ready</Heading>
      <Text style={typography.text}>
        Hi {name}, here is the short path to your first real result.
      </Text>
      <Section style={{ marginBottom: '24px' }}>
        {steps.map((step, index) => (
          <Row key={step.url + step.title} style={{ marginBottom: '12px' }}>
            <Column style={{ width: '28px', verticalAlign: 'top' }}>
              <Text style={stepNumber}>{index + 1}</Text>
            </Column>
            <Column>
              <Text style={stepTitle}>
                <Link href={step.url} style={utils.link}>
                  {step.title}
                </Link>
              </Text>
              <Text style={stepOutcome}>{step.outcome}</Text>
            </Column>
          </Row>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', marginBottom: '32px' }}>
        <Button style={button.primary} href={homeUrl}>
          Open {workspaceName}
        </Button>
      </Section>
      <NotificationFooter
        reason="You're getting this because you just set up this workspace."
        unsubscribeUrl={unsubscribeUrl}
        unsubscribeLabel="Stop setup tips"
      />
    </EmailLayout>
  )
}

const stepNumber = {
  color: colors.primary,
  fontSize: '15px',
  fontWeight: '700' as const,
  lineHeight: '22px',
  margin: '0',
}

const stepTitle = {
  fontSize: '15px',
  fontWeight: '600' as const,
  lineHeight: '22px',
  margin: '0',
}

const stepOutcome = {
  color: colors.textMuted,
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
}
