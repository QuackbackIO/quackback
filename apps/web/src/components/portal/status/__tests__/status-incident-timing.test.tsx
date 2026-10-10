// @vitest-environment happy-dom
/**
 * A maintenance window is dated by its window, not by when it was created: a
 * window scheduled for next week must never say "Started <today>".
 */
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import {
  StatusIncidentTiming,
  formatMaintenanceWindow,
  statusIncidentDate,
  type StatusIncidentTimingData,
} from '../status-incident-timing'

afterEach(cleanup)

function renderTiming(incident: StatusIncidentTimingData) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <StatusIncidentTiming incident={incident} />
    </IntlProvider>
  )
}

const maintenance = {
  kind: 'maintenance' as const,
  // A creation-time stamp from before the window, which the old page showed
  // as "Started"; the scheduled view must not use it.
  startedAt: '2026-10-01T08:00:00.000Z',
  scheduledStartAt: '2026-10-12T14:00:00.000Z',
  scheduledEndAt: '2026-10-12T16:00:00.000Z',
}

describe('StatusIncidentTiming', () => {
  it('says when a scheduled window is planned for, start to end', () => {
    renderTiming({ ...maintenance, status: 'scheduled' })
    expect(
      screen.getByText('Scheduled for Monday, October 12 · 14:00 – 16:00 UTC')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Started/)).toBeNull()
  })

  it('says when a scheduled window starts when it has no end', () => {
    renderTiming({ ...maintenance, status: 'scheduled', scheduledEndAt: null })
    expect(screen.getByText('Starts Monday, October 12 · 14:00 UTC')).toBeInTheDocument()
  })

  it('says when a running window started, and still shows its window', () => {
    renderTiming({ ...maintenance, status: 'in_progress', startedAt: '2026-10-12T14:02:00.000Z' })
    expect(screen.getByText('Started October 12, 2026 at 14:02 UTC')).toBeInTheDocument()
    expect(
      screen.getByText('Scheduled window: Monday, October 12 · 14:00 – 16:00 UTC')
    ).toBeInTheDocument()
  })

  it('says when an incident started', () => {
    renderTiming({
      kind: 'incident',
      status: 'investigating',
      startedAt: '2026-10-12T09:30:00.000Z',
      scheduledStartAt: null,
      scheduledEndAt: null,
    })
    expect(screen.getByText('Started October 12, 2026 at 09:30 UTC')).toBeInTheDocument()
  })
})

describe('formatMaintenanceWindow', () => {
  it('names the end day when the window crosses midnight UTC', () => {
    expect(
      formatMaintenanceWindow('2026-10-12T22:00:00.000Z', '2026-10-13T02:00:00.000Z', 'en')
    ).toBe('Monday, October 12 · 22:00 – Tuesday, October 13 · 02:00 UTC')
  })
})

describe('statusIncidentDate', () => {
  it('files a maintenance window under its start, not its creation', () => {
    expect(statusIncidentDate({ ...maintenance, status: 'completed' })).toBe(
      maintenance.scheduledStartAt
    )
  })
})
