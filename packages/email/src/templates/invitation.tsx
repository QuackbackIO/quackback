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

interface InvitationEmailProps {
  invitedByName: string
  inviteeName?: string
  organizationName: string
  inviteLink: string
}

const LOGO_URL = 'https://quackback.io/logo.png'

export function InvitationEmail({
  invitedByName,
  inviteeName,
  organizationName,
  inviteLink,
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Join {organizationName} on Quackback</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          {/* Logo */}
          <Section style={branding.logoContainer}>
            <Img src={LOGO_URL} alt="Quackback" style={branding.logo} />
          </Section>

          {/* Content */}
          <Heading style={typography.h1}>
            {inviteeName ? `Hi ${inviteeName}, you're invited!` : "You're invited!"}
          </Heading>
          <Text style={typography.text}>
            <strong>{invitedByName}</strong> has invited you to join{' '}
            <strong>{organizationName}</strong> on Quackback.
          </Text>

          {/* CTA Button */}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button style={button.primary} href={inviteLink}>
              Accept Invitation
            </Button>
          </Section>

          {/* Fallback Link */}
          <Text style={typography.textSmall}>
            Or copy and paste this link into your browser:{' '}
            <Link href={inviteLink} style={utils.link}>
              {inviteLink}
            </Link>
          </Text>

          {/* Footer */}
          <Text style={typography.footer}>
            If you weren&apos;t expecting this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
