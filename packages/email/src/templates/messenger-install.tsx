import { Heading, Section, Text } from '@react-email/components'
import { EmailLayout, TransactionalFooter } from './email-layout'
import { typography, colors } from './shared-styles'

interface MessengerInstallEmailProps {
  senderName: string
  workspaceName: string
  snippet: string
  logoUrl?: string
}

/** A teammate asks whoever edits the website to add Messenger. */
export function MessengerInstallEmail({
  senderName,
  workspaceName,
  snippet,
  logoUrl,
}: MessengerInstallEmailProps) {
  return (
    <EmailLayout
      preview={`Add ${workspaceName} Messenger to the website`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      <Heading style={typography.h1}>Add Messenger to the website</Heading>
      <Text style={typography.text}>
        <strong>{senderName}</strong> asked you to put {workspaceName}&apos;s Messenger on the
        website. Paste this code before the closing body tag on every page.
      </Text>
      <Section style={codeBlock}>
        <Text style={codeText}>{snippet}</Text>
      </Section>
      <Text style={typography.textSmall}>
        Using Google Tag Manager? Create a Custom HTML tag with the same code and trigger it on All
        pages.
      </Text>
      <TransactionalFooter>
        {senderName} will see Messenger connect as soon as it loads on the site.
      </TransactionalFooter>
    </EmailLayout>
  )
}

const codeBlock = {
  backgroundColor: '#F4F4F5',
  borderRadius: '8px',
  padding: '12px 16px',
  margin: '16px 0',
}

const codeText = {
  color: colors.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '12px',
  lineHeight: '18px',
  whiteSpace: 'pre-wrap' as const,
  margin: '0',
}
