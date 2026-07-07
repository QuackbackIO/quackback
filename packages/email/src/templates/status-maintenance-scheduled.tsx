import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button } from './shared-styles'

const MAINTENANCE_BLUE = '#3b82f6'
const MAINTENANCE_BLUE_BG = '#eff6ff'
const MAINTENANCE_BLUE_BORDER = '#bfdbfe'

interface StatusMaintenanceScheduledEmailProps {
  workspaceName: string
  maintenanceTitle: string
  /** Plain text description of the maintenance. */
  body: string
  /** Pre-formatted display string for the start of the maintenance window. */
  startLabel: string
  /** Pre-formatted display string for the end of the maintenance window. */
  endLabel: string
  /** Component names only (no status), since maintenance is scheduled ahead of impact. */
  affectedComponents: string[]
  incidentUrl: string
  unsubscribeUrl: string
  logoUrl?: string
}

export function StatusMaintenanceScheduledEmail({
  workspaceName,
  maintenanceTitle,
  body,
  startLabel,
  endLabel,
  affectedComponents,
  incidentUrl,
  unsubscribeUrl,
  logoUrl,
}: StatusMaintenanceScheduledEmailProps) {
  return (
    <EmailLayout
      preview={`Scheduled maintenance: ${maintenanceTitle} (${startLabel})`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      {/* Content */}
      <Text
        style={{
          color: MAINTENANCE_BLUE,
          fontSize: '13px',
          fontWeight: '700',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginTop: '0',
          marginBottom: '8px',
        }}
      >
        Scheduled maintenance
      </Text>
      <Heading style={typography.h1}>{maintenanceTitle}</Heading>
      <Text style={typography.text}>
        {workspaceName} has scheduled maintenance that may affect its services.
      </Text>
      {body && <Text style={typography.text}>{body}</Text>}

      {/* Maintenance window */}
      <Section
        style={{
          backgroundColor: MAINTENANCE_BLUE_BG,
          border: `1px solid ${MAINTENANCE_BLUE_BORDER}`,
          borderRadius: '8px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <Text
          style={{
            color: MAINTENANCE_BLUE,
            fontSize: '13px',
            fontWeight: '600',
            marginTop: '0',
            marginBottom: '4px',
          }}
        >
          Maintenance window
        </Text>
        <Text style={{ ...typography.text, marginTop: '0', marginBottom: '0', fontWeight: '600' }}>
          {startLabel} to {endLabel}
        </Text>
      </Section>

      {/* Affected components */}
      {affectedComponents.length > 0 && (
        <Section style={{ marginBottom: '24px' }}>
          <Text
            style={{
              ...typography.textSmall,
              fontWeight: '600',
              marginTop: '0',
              marginBottom: '8px',
            }}
          >
            Affected components
          </Text>
          <Text style={{ ...typography.textSmall, marginTop: '0', marginBottom: '0' }}>
            {affectedComponents.join(', ')}
          </Text>
        </Section>
      )}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={incidentUrl}>
          View status page
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason="You received this email because you're subscribed to status updates."
        unsubscribeUrl={unsubscribeUrl}
      />
    </EmailLayout>
  )
}
