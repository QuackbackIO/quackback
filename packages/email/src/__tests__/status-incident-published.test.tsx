import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { StatusIncidentPublishedEmail } from '../templates/status-incident-published'
import { StatusMaintenanceScheduledEmail } from '../templates/status-maintenance-scheduled'

const incident = {
  workspaceName: 'Acme',
  incidentTitle: 'API errors',
  impact: 'major' as const,
  statusLabel: 'Investigating',
  affectedComponents: [{ name: 'API', status: 'Partial outage' }],
  incidentUrl: 'https://acme.example.com/status/status_incident_1',
  unsubscribeUrl: 'https://acme.example.com/unsubscribe?token=t',
}

describe('StatusIncidentPublishedEmail', () => {
  it('keeps the line breaks the update was written with', async () => {
    const html = await render(
      <StatusIncidentPublishedEmail
        {...incident}
        body={'We are seeing errors.\nA fix is rolling out.\r\nNext update in 30 minutes.'}
      />
    )
    expect(html).toMatch(/We are seeing errors\.<br\s*\/?>A fix is rolling out\.<br\s*\/?>Next/)
  })

  it('escapes markup in the body instead of rendering it', async () => {
    const html = await render(
      <StatusIncidentPublishedEmail {...incident} body={'<img src=x onerror=alert(1)>\nhello'} />
    )
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toMatch(/<br\s*\/?>hello/)
  })
})

describe('StatusMaintenanceScheduledEmail', () => {
  it('keeps the line breaks the description was written with', async () => {
    const html = await render(
      <StatusMaintenanceScheduledEmail
        workspaceName="Acme"
        maintenanceTitle="Database upgrade"
        body={'Writes pause briefly.\nReads stay up.'}
        startLabel="October 12, 2026, 02:00 UTC"
        endLabel="October 12, 2026, 04:00 UTC"
        affectedComponents={['API']}
        incidentUrl="https://acme.example.com/status/status_incident_2"
        unsubscribeUrl="https://acme.example.com/unsubscribe?token=t"
      />
    )
    expect(html).toMatch(/Writes pause briefly\.<br\s*\/?>Reads stay up\./)
  })
})
