import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'

interface InvitationEmailProps {
  invitedByEmail: string
  organizationName: string
  inviteLink: string
}

export function InvitationEmail({
  invitedByEmail,
  organizationName,
  inviteLink,
}: InvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Join {organizationName} on Quackback</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>You&apos;re invited!</Heading>
          <Text style={text}>
            <strong>{invitedByEmail}</strong> has invited you to join{' '}
            <strong>{organizationName}</strong> on Quackback.
          </Text>
          <Section style={buttonContainer}>
            <Button style={button} href={inviteLink}>
              Accept Invitation
            </Button>
          </Section>
          <Text style={text}>
            Or copy and paste this URL into your browser:{' '}
            <Link href={inviteLink} style={link}>
              {inviteLink}
            </Link>
          </Text>
          <Text style={footer}>
            If you weren&apos;t expecting this invitation, you can ignore this email.
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

const link = {
  color: '#2563eb',
}

const footer = {
  color: '#9ca3af',
  fontSize: '14px',
  margin: '40px 0 0',
}
