import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, utils } from './shared-styles'

interface VerifyAddressEmailProps {
  code: string
  workspaceName?: string
  logoUrl?: string
}

/**
 * Proves control of an address someone is adding to, or moving, their account.
 *
 * Deliberately NOT the sign-in template. That one is headed "Sign in to
 * Quackback", and showing it to someone who just asked to change their address
 * reads as a phishing attempt — the action they took and the mail they received
 * would not match. Same code presentation, different sentence.
 *
 * There is no link. The person is already in the app, on the page that asked
 * for the address, so a code they type back keeps them in that context and
 * gives a cross-device link no chance to be intercepted.
 */
export function VerifyAddressEmail({ code, workspaceName, logoUrl }: VerifyAddressEmailProps) {
  const where = workspaceName ? ` for ${workspaceName}` : ''
  return (
    <EmailLayout preview={`Your verification code${where}`} logoUrl={logoUrl}>
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>Confirm your email</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Enter this code{where} to confirm this address. It expires in 10 minutes.
      </Text>
      <Section style={utils.codeBox}>
        <Text style={utils.code}>{code}</Text>
      </Section>
      <Text style={{ ...typography.footer, textAlign: 'center' }}>
        If you didn&apos;t ask for this, ignore it — nothing changes without the code.
      </Text>
      <TransactionalFooter>
        You&rsquo;re receiving this because someone entered this address on an account. It
        won&rsquo;t be used for anything until it&rsquo;s confirmed.
      </TransactionalFooter>
    </EmailLayout>
  )
}
