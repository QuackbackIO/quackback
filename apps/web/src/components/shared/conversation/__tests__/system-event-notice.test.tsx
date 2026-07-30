// @vitest-environment happy-dom
/**
 * SystemEventNotice workflow attribution: a system notice posted because a
 * workflow fired names that workflow in the thread ("Conversation ended · via
 * Auto-close after CSAT"), so both sides can tell automation from a teammate's
 * action. Notices with no attribution render exactly as before.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { SystemEventNotice } from '../system-event-notice'

function renderNotice(event: Parameters<typeof SystemEventNotice>[0]['event'], fallback = '') {
  return render(
    <IntlProvider locale="en">
      <SystemEventNotice event={event} fallback={fallback} />
    </IntlProvider>
  )
}

describe('<SystemEventNotice> workflow attribution', () => {
  it('names the firing workflow next to a localized notice', () => {
    renderNotice({ kind: 'chat_ended', workflowName: 'Auto-close after CSAT' })
    expect(screen.getByText(/Conversation ended/)).toBeInTheDocument()
    expect(screen.getByText(/Auto-close after CSAT/)).toBeInTheDocument()
  })

  it('names the workflow on an attributed assignment notice too', () => {
    renderNotice({ kind: 'assigned', agentName: 'Rae', workflowName: 'New-chat triage' })
    expect(screen.getByText(/New-chat triage/)).toBeInTheDocument()
  })

  it('renders no attribution when the event carries none', () => {
    const { container } = renderNotice({ kind: 'chat_ended' })
    expect(screen.getByText('Conversation ended')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/via/)
  })

  it('attributes the raw fallback for legacy rows that carry a workflow name in content only', () => {
    // Unknown/legacy kinds fall back to stored content; attribution still shows.
    renderNotice(null, 'Conversation ended')
    expect(screen.getByText('Conversation ended')).toBeInTheDocument()
  })
})
