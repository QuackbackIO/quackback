import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography } from './shared-styles'
import { BrandButton, BrandLink } from './brand-parts'

interface PasswordResetEmailProps {
  resetLink: string
  logoUrl?: string
}

export function PasswordResetEmail({ resetLink, logoUrl }: PasswordResetEmailProps) {
  return (
    <EmailLayout preview="Reset your Quackback password" logoUrl={logoUrl}>
      {/* Content */}
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>Reset your password</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Click the button below to set a new password. This link expires in 24 hours.
      </Text>

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <BrandButton href={resetLink}>Reset Password</BrandButton>
      </Section>

      {/* Fallback Link */}
      <Text style={typography.textSmall}>
        Or copy and paste this link into your browser:{' '}
        <BrandLink href={resetLink}>{resetLink}</BrandLink>
      </Text>

      {/* Footer */}
      <TransactionalFooter>
        If you didn&apos;t request a password reset, you can safely ignore this email.
      </TransactionalFooter>
    </EmailLayout>
  )
}
