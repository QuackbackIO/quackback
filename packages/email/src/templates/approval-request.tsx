import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button } from './shared-styles'

export interface ApprovalRequestEmailProps {
  summary: string
  reviewUrl: string
  workspaceName: string
  preferencesUrl?: string
  logoUrl?: string
}

/** The link only opens the request. A signed-in person confirms it on the page. */
export function ApprovalRequestEmail({
  summary,
  reviewUrl,
  workspaceName,
  preferencesUrl,
  logoUrl,
}: ApprovalRequestEmailProps) {
  return (
    <EmailLayout
      preview={`Approval requested in ${workspaceName}`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      <Heading style={typography.h1}>Approval requested</Heading>
      <Text style={typography.text}>{summary}</Text>
      <Section style={{ textAlign: 'center', marginTop: '24px', marginBottom: '24px' }}>
        <Button style={button.primary} href={reviewUrl}>
          Review request
        </Button>
      </Section>
      {preferencesUrl && (
        <NotificationFooter
          reason={`You can decide this request in ${workspaceName}.`}
          unsubscribeUrl={preferencesUrl}
          unsubscribeLabel="Manage notification preferences"
        />
      )}
    </EmailLayout>
  )
}
