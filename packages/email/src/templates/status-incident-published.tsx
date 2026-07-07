import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'

export type IncidentImpact = 'none' | 'minor' | 'major' | 'critical'

interface AffectedComponent {
  name: string
  /** Humanized status label, e.g. "Degraded performance". */
  status: string
}

interface StatusIncidentPublishedEmailProps {
  workspaceName: string
  incidentTitle: string
  impact: IncidentImpact
  /** Humanized incident status, e.g. "Investigating". */
  statusLabel: string
  /** Plain text of the first update. */
  body: string
  affectedComponents: AffectedComponent[]
  incidentUrl: string
  unsubscribeUrl: string
  logoUrl?: string
}

const impactColors: Record<IncidentImpact, string> = {
  none: '#94a3b8',
  minor: '#f59e0b',
  major: '#f97316',
  critical: '#ef4444',
}

const impactLabels: Record<IncidentImpact, string> = {
  none: 'No impact',
  minor: 'Minor impact',
  major: 'Major impact',
  critical: 'Critical impact',
}

export function StatusIncidentPublishedEmail({
  workspaceName,
  incidentTitle,
  impact,
  statusLabel,
  body,
  affectedComponents,
  incidentUrl,
  unsubscribeUrl,
  logoUrl,
}: StatusIncidentPublishedEmailProps) {
  const accentColor = impactColors[impact]

  return (
    <EmailLayout
      preview={`${incidentTitle} (${statusLabel})`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
    >
      {/* Content */}
      <Heading style={typography.h1}>New incident reported</Heading>
      <Text style={typography.text}>{workspaceName} just posted an update to its status page.</Text>

      {/* Impact bar */}
      <Section
        style={{
          backgroundColor: accentColor,
          borderRadius: '8px 8px 0 0',
          padding: '10px 20px',
        }}
      >
        <Text
          style={{
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: '700',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginTop: '0',
            marginBottom: '0',
          }}
        >
          {impactLabels[impact]} &middot; {statusLabel}
        </Text>
      </Section>

      {/* Incident details */}
      <Section
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: '0 0 8px 8px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <Text
          style={{
            ...typography.text,
            marginTop: '0',
            marginBottom: body ? '8px' : '0',
            fontWeight: '600',
          }}
        >
          {incidentTitle}
        </Text>
        {body && (
          <Text style={{ ...typography.textSmall, marginTop: '0', marginBottom: '0' }}>{body}</Text>
        )}
      </Section>

      {/* Affected components */}
      {affectedComponents.length > 0 && (
        <Section style={{ marginBottom: '24px' }}>
          <Text
            style={{
              ...typography.textSmall,
              color: colors.heading,
              fontWeight: '600',
              marginTop: '0',
              marginBottom: '8px',
            }}
          >
            Affected components
          </Text>
          {affectedComponents.map((component) => (
            <Text
              key={component.name}
              style={{ ...typography.textSmall, marginTop: '0', marginBottom: '4px' }}
            >
              <strong>{component.name}:</strong> {component.status}
            </Text>
          ))}
        </Section>
      )}

      {/* CTA Button */}
      <Section style={{ textAlign: 'center', marginTop: '32px', marginBottom: '32px' }}>
        <Button style={button.primary} href={incidentUrl}>
          View live status
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
