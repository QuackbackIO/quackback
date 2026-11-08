import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'
import { BrandButton, BrandLink } from './brand-parts'

interface PortalInviteEmailProps {
  workspaceName: string
  inviteLink: string
  logoUrl?: string
  personalMessage?: string
}

export function PortalInviteEmail({
  workspaceName,
  inviteLink,
  logoUrl,
  personalMessage,
}: PortalInviteEmailProps) {
  return (
    <EmailLayout
      preview={`You've been invited to access the ${workspaceName} portal`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      {/* Content */}
      <Heading style={typography.h1}>You&apos;ve been invited!</Heading>
      <Text style={typography.text}>
        You&apos;ve been invited to access the <strong>{workspaceName}</strong> portal. Click below
        to accept and sign in.
      </Text>

      {personalMessage && (
        <Section
          style={{
            backgroundColor: '#f6f8fa',
            borderLeft: '3px solid #d0d7de',
            padding: '12px 16px',
            marginTop: '24px',
            marginBottom: '8px',
            borderRadius: '4px',
          }}
        >
          <Text style={{ ...typography.textSmall, margin: 0, fontStyle: 'italic' }}>
            {personalMessage}
          </Text>
        </Section>
      )}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <BrandButton href={inviteLink}>Accept invitation</BrandButton>
      </Section>

      {/* Fallback Link */}
      <Text style={typography.textSmall}>
        Or copy and paste this link into your browser:{' '}
        <BrandLink href={inviteLink}>{inviteLink}</BrandLink>
      </Text>

      {/* Footer */}
      <TransactionalFooter>
        If you weren&apos;t expecting this invitation, you can ignore this email.
      </TransactionalFooter>
    </EmailLayout>
  )
}
