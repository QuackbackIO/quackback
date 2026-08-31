import { Button, Heading, Link, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button, utils } from './shared-styles'

interface PasswordResetEmailProps {
  resetLink: string
  logoUrl?: string
  brandName?: string
}

export function PasswordResetEmail({
  resetLink,
  logoUrl,
  brandName = 'Quackback',
}: PasswordResetEmailProps) {
  return (
    <EmailLayout preview={`Reset your ${brandName} password`} logoUrl={logoUrl} logoAlt={brandName}>
      {/* Content */}
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>Reset your password</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Click the button below to set a new password. This link expires in 24 hours.
      </Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
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
      <TransactionalFooter>
        If you didn&apos;t request a password reset, you can safely ignore this email.
      </TransactionalFooter>
    </EmailLayout>
  )
}
