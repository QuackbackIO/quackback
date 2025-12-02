import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface WelcomeEmailProps {
  name: string
  appUrl?: string
}

export function WelcomeEmail({ name, appUrl = 'https://app.quackback.io' }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Quackback</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to Quackback!</Heading>
          <Text style={text}>
            Hi {name}, thanks for signing up! You&apos;re all set to start collecting
            and managing customer feedback.
          </Text>
          <Text style={text}>Here&apos;s what you can do next:</Text>
          <ul style={list}>
            <li>Create your first feedback board</li>
            <li>Invite your team members</li>
            <li>Set up integrations with GitHub, Slack, or Discord</li>
            <li>Share your public roadmap with customers</li>
          </ul>
          <Section style={buttonContainer}>
            <Button style={button} href={`${appUrl}/admin`}>
              Go to Dashboard
            </Button>
          </Section>
          <Text style={footer}>
            Happy collecting!
            <br />
            The Quackback Team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 20px',
  maxWidth: '560px',
}

const h1 = {
  color: '#1f2937',
  fontSize: '24px',
  fontWeight: '600',
  margin: '0 0 20px',
}

const text = {
  color: '#4b5563',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 20px',
}

const list = {
  color: '#4b5563',
  fontSize: '16px',
  lineHeight: '28px',
  margin: '0 0 20px',
  paddingLeft: '20px',
}

const buttonContainer = {
  margin: '30px 0',
}

const button = {
  backgroundColor: '#000000',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  padding: '12px 24px',
  textDecoration: 'none',
}

const footer = {
  color: '#9ca3af',
  fontSize: '14px',
  margin: '40px 0 0',
}
