import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import { layout, typography, button, utils, branding } from './shared-styles'

interface PasswordResetEmailProps {
  resetLink: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function PasswordResetEmail({ resetLink }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your Quackback password</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={{ ...typography.h1, textAlign: 'center' }}>Reset your password</Heading>
          <Text style={{ ...typography.text, textAlign: 'center' }}>
            Click the button below to set a new password. This link expires in 24 hours.
          </Text>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={resetLink}>
              Reset Password
            </Button>
          </Section>

          {/* Fallback Link */}
          <Text style={typography.textSmall}>
            Or copy and paste this link into your browser:{' '}
            <Link href={resetLink} style={utils.link}>
              {resetLink}
            </Link>
          </Text>

          {/* Footer */}
          <Text style={typography.footer}>
            If you didn&apos;t request a password reset, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
