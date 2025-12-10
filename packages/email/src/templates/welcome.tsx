import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { layout, typography, button, branding, colors } from './shared-styles'

interface WelcomeEmailProps {
  name: string
  workspaceName: string
  dashboardUrl: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function WelcomeEmail({ name, workspaceName, dashboardUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to {workspaceName} on Quackback</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={typography.h1}>Welcome to Quackback!</Heading>
          <Text style={typography.text}>
            Hi {name}, your workspace <strong>{workspaceName}</strong> is ready. Start collecting
            and managing customer feedback today.
          </Text>

          {/* Features List */}
          <Section style={featureList}>
            <Text style={featureItem}>
              <span style={featureIcon}>&#10003;</span> Create feedback boards
            </Text>
            <Text style={featureItem}>
              <span style={featureIcon}>&#10003;</span> Invite your team
            </Text>
            <Text style={featureItem}>
              <span style={featureIcon}>&#10003;</span> Share your public roadmap
            </Text>
            <Text style={featureItem}>
              <span style={featureIcon}>&#10003;</span> Connect GitHub, Slack & Discord
            </Text>
          </Section>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={dashboardUrl}>
              Go to Dashboard
            </Button>
          </Section>

          {/* Footer */}
          <Text style={typography.footer}>
            Happy collecting!
            <br />
            The Quackback Team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const featureList = {
  margin: '24px 0',
  padding: '0',
}

const featureItem = {
  color: colors.text,
  fontSize: '15px',
  lineHeight: '28px',
  margin: '0',
  paddingLeft: '8px',
}

const featureIcon = {
  color: colors.primary,
  fontWeight: '700',
  marginRight: '12px',
}
