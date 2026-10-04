import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, utils } from './shared-styles'

interface OnboardingNudgeEmailProps {
  name: string
  workspaceName: string
  nextStep: { title: string; url: string }
  test: { label: string; url: string } | null
  unsubscribeUrl: string
  logoUrl?: string
}

/** Sent at most once, on day two, when the first real result has not happened yet. */
export function OnboardingNudgeEmail({
  name,
  workspaceName,
  nextStep,
  test,
  unsubscribeUrl,
  logoUrl,
}: OnboardingNudgeEmailProps) {
  return (
    <EmailLayout
      preview={`Your next step in ${workspaceName}`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      <Heading style={typography.h1}>Your next step</Heading>
      <Text style={typography.text}>
        Hi {name}, {workspaceName} is set up. The next step takes a minute.
      </Text>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button style={button.primary} href={nextStep.url}>
          {nextStep.title}
        </Button>
      </Section>
      {test ? (
        <Text style={typography.textSmall}>
          Want to see it work first?{' '}
          <Link href={test.url} style={utils.link}>
            {test.label}
          </Link>
        </Text>
      ) : null}
      <NotificationFooter
        reason="You're getting this because you set up this workspace this week."
        unsubscribeUrl={unsubscribeUrl}
        unsubscribeLabel="Stop setup tips"
      />
    </EmailLayout>
  )
}
