// @vitest-environment happy-dom
/**
 * Test for VisitorMessageBubble: assistant (isAssistant=true) messages render
 * the name as one cohesive "✨ Name AI" label (no separate badge chip); the
 * "AI" suffix never renders for non-assistant messages.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { VisitorMessageBubble } from '../message-bubble'

afterEach(cleanup)

function renderBubble(props: Parameters<typeof VisitorMessageBubble>[0]) {
  return render(
    <IntlProvider locale="en-US" messages={{}}>
      <VisitorMessageBubble {...props} />
    </IntlProvider>
  )
}

describe('VisitorMessageBubble', () => {
  it('renders the name as "Quinn AI" for assistant messages, without a badge chip', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello there',
      authorName: 'Quinn',
      isAssistant: true,
      time: '10:30 AM',
    })

    const attribution = screen.getByText(
      (_, el) => el?.tagName === 'P' && el.textContent === 'Quinn AI · 10:30 AM'
    )
    expect(attribution).toBeInTheDocument()
    expect(attribution).toHaveClass('text-muted-foreground/70')
    expect(attribution.querySelector('svg')).not.toBeNull()
    expect(attribution.querySelector('.rounded')).toBeNull()
  })

  it('does not render the AI suffix for non-assistant peer messages', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello',
      authorName: 'Agent Name',
      isAssistant: false,
      time: '10:30 AM',
    })

    expect(screen.queryByText(/AI/)).not.toBeInTheDocument()
  })

  it('renders visitor (self) messages without any assistant labels', () => {
    renderBubble({
      side: 'self',
      content: 'Hi there',
      isAssistant: false,
    })

    expect(screen.queryByText(/AI/)).not.toBeInTheDocument()
  })
})
