import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout, NotificationFooter } from './email-layout'
import { typography, button, colors } from './shared-styles'
import { withLineBreaks } from './line-breaks'
import { ENGLISH_EMAIL, defineEmailMessages, type EmailLocale } from '../i18n'

export const STATUS_EMAIL_MESSAGES = defineEmailMessages({
  incidentSubject: { id: 'email.status.incidentSubject', defaultMessage: 'Incident: {title}' },
  incidentHeading: { id: 'email.status.incidentHeading', defaultMessage: 'New incident reported' },
  incidentBody: {
    id: 'email.status.incidentBody',
    defaultMessage: '{workspace} just posted an update to its status page.',
  },
  affected: { id: 'email.status.affected', defaultMessage: 'Affected services' },
  viewLive: { id: 'email.status.viewLive', defaultMessage: 'View live status' },
  reason: {
    id: 'email.status.reason',
    defaultMessage: "You received this email because you're subscribed to status updates.",
  },
  unsubscribe: {
    id: 'email.status.unsubscribe',
    defaultMessage: 'Unsubscribe from status updates',
  },
  maintenanceSubject: {
    id: 'email.status.maintenanceSubject',
    defaultMessage: 'Scheduled maintenance: {title}',
  },
  maintenanceLabel: {
    id: 'email.status.maintenanceLabel',
    defaultMessage: 'Scheduled maintenance',
  },
  maintenanceBody: {
    id: 'email.status.maintenanceBody',
    defaultMessage: '{workspace} has scheduled maintenance that may affect its services.',
  },
  window: { id: 'email.status.window', defaultMessage: 'Maintenance window' },
  viewPage: { id: 'email.status.viewPage', defaultMessage: 'View status page' },
  impactNone: { id: 'portal.status.impact.none', defaultMessage: 'No impact' },
  impactMinor: { id: 'portal.status.impact.minor', defaultMessage: 'Minor impact' },
  impactMajor: { id: 'portal.status.impact.major', defaultMessage: 'Major impact' },
  impactCritical: { id: 'portal.status.impact.critical', defaultMessage: 'Critical impact' },
})
const M = STATUS_EMAIL_MESSAGES

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
  /** Plain text of the first update. Its line breaks are kept. */
  body: string
  affectedComponents: AffectedComponent[]
  incidentUrl: string
  unsubscribeUrl: string
  preferencesUrl?: string
  logoUrl?: string
  i18n?: EmailLocale
}

const impactColors: Record<IncidentImpact, string> = {
  none: '#94a3b8',
  minor: '#f59e0b',
  major: '#f97316',
  critical: '#ef4444',
}

const impactLabels = {
  none: M.impactNone,
  minor: M.impactMinor,
  major: M.impactMajor,
  critical: M.impactCritical,
} as const

export function StatusIncidentPublishedEmail({
  workspaceName,
  incidentTitle,
  impact,
  statusLabel,
  body,
  affectedComponents,
  incidentUrl,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
  i18n = ENGLISH_EMAIL,
}: StatusIncidentPublishedEmailProps) {
  const { t } = i18n
  const accentColor = impactColors[impact]

  return (
    <EmailLayout
      preview={`${incidentTitle} (${statusLabel})`}
      logoUrl={logoUrl}
      logoAlt={workspaceName}
      i18n={i18n}
    >
      {/* Content */}
      <Heading style={typography.h1}>{t(M.incidentHeading)}</Heading>
      <Text style={typography.text}>{t(M.incidentBody, { workspace: workspaceName })}</Text>

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
          {t(impactLabels[impact])} &middot; {statusLabel}
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
          <Text style={{ ...typography.textSmall, marginTop: '0', marginBottom: '0' }}>
            {withLineBreaks(body)}
          </Text>
        )}
      </Section>

      {/* Affected services */}
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
            {t(M.affected)}
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
          {t(M.viewLive)}
        </Button>
      </Section>

      {/* Footer */}
      <NotificationFooter
        reason={t(M.reason)}
        unsubscribeUrl={unsubscribeUrl}
        unsubscribeLabel={t(M.unsubscribe)}
        preferencesUrl={preferencesUrl}
        i18n={i18n}
      />
    </EmailLayout>
  )
}
