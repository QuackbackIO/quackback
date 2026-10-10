// @vitest-environment happy-dom
/**
 * The status page states update times in UTC ("02:00 UTC"), so the day beside
 * a time is the UTC day too: 02:00 UTC on Oct 1 is still Sep 30 in Los
 * Angeles, and a day taken from the runtime's zone would contradict the time.
 */
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { StatusIncidentTimeline } from '../status-incident-timeline'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

describe('StatusIncidentTimeline', () => {
  it('dates an update by its UTC day, matching its UTC time', () => {
    setRuntimeLocale('en-US', 'America/Los_Angeles')
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <StatusIncidentTimeline
          updates={[
            {
              id: 'u1',
              status: 'investigating',
              body: 'Looking into it',
              createdAt: '2026-10-01T02:00:00.000Z',
            },
          ]}
        />
      </IntlProvider>
    )
    expect(screen.getByText(/02:00 UTC/).textContent).toBe('October 1, 2026 · 02:00 UTC')
  })

  it.each([false, true])(
    'keeps the line breaks an update was written with (compact: %s)',
    (compact) => {
      render(
        <IntlProvider locale="en" defaultLocale="en">
          <StatusIncidentTimeline
            compact={compact}
            updates={[
              {
                id: 'u1',
                status: 'identified',
                body: 'Root cause found.\nA fix is rolling out.',
                createdAt: '2026-10-01T02:00:00.000Z',
              },
            ]}
          />
        </IntlProvider>
      )
      const body = screen.getByText(/Root cause found\./)
      expect(body.textContent).toBe('Root cause found.\nA fix is rolling out.')
      // Collapsed whitespace would join the lines; pre-line renders the newline.
      expect(body).toHaveClass('whitespace-pre-line')
    }
  )
})
