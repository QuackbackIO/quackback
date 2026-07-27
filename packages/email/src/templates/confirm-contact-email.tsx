import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, button } from './shared-styles'

interface ConfirmContactEmailProps {
  workspaceName?: string
  confirmUrl: string
  logoUrl?: string
}

/**
 * Sent when somebody asks us to use this address for their notifications.
 *
 * They signed in through a provider that gives out no email, so their account
 * carries an undeliverable placeholder and nothing can reach them. This is the
 * only message that address will ever receive, and it is the proof of control
 * that lets it become a delivery target.
 *
 * The copy leads with why this arrived, because the recipient may not have
 * asked for it: anyone can type any address, which is exactly why it is
 * confirmed before use.
 */
export function ConfirmContactEmail({
  workspaceName,
  confirmUrl,
  logoUrl,
}: ConfirmContactEmailProps) {
  const workspaceLabel = workspaceName ?? 'a Quackback workspace'
  return (
    <EmailLayout preview={`Confirm this address for ${workspaceLabel}`} logoUrl={logoUrl}>
      <Heading style={{ ...typography.h1, textAlign: 'center' }}>Confirm your email</Heading>
      <Text style={{ ...typography.text, textAlign: 'center' }}>
        Someone signed in to {workspaceLabel} and asked for replies to be sent here. Confirm the
        address and we will use it to let you know when someone answers you.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={confirmUrl} style={button.primary}>
          Confirm this address
        </Button>
      </Section>
      <Text style={{ ...typography.footer, textAlign: 'center' }}>
        The link expires in an hour. If this was not you, ignore this message and nothing changes.
      </Text>
      <TransactionalFooter>
        You&apos;re receiving this because someone asked us to send their notifications here. Until
        the address is confirmed, we won&apos;t use it for anything else.
      </TransactionalFooter>
    </EmailLayout>
  )
}
