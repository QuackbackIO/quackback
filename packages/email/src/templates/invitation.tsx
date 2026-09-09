import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button, utils } from './shared-styles'

interface InvitationEmailProps {
  invitedByName: string
  inviteeName?: string
  organizationName: string
  inviteLink: string
  logoUrl?: string
  brandName?: string
}

export function InvitationEmail({
  invitedByName,
  inviteeName,
  organizationName,
  inviteLink,
  logoUrl,
  brandName = 'Quackback',
}: InvitationEmailProps) {
  return (
    <EmailLayout
      preview={`Join ${organizationName} on ${brandName}`}
      logoUrl={logoUrl}
      logoAlt={organizationName}
    >
      {/* Content */}
      <Heading style={typography.h1}>
        {inviteeName ? `Hi ${inviteeName}, you're invited!` : "You're invited!"}
      </Heading>
      <Text style={typography.text}>
        <strong>{invitedByName}</strong> has invited you to join <strong>{organizationName}</strong>{' '}
        on {brandName}.
      </Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
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
      <TransactionalFooter>
        If you weren&apos;t expecting this invitation, you can ignore this email.
      </TransactionalFooter>
    </EmailLayout>
  )
}
