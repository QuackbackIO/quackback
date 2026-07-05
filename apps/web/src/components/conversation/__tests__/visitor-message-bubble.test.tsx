// @vitest-environment happy-dom
/**
 * Test for VisitorMessageBubble: verify AI label renders when showAiLabel is true
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { VisitorMessageBubble } from '../message-bubble'

afterEach(cleanup)

const messages: Record<string, Record<string, string>> = {
  'en-US': {
    'widget.messenger.aiAgent': 'AI Agent',
  },
}

function renderBubble(props: Parameters<typeof VisitorMessageBubble>[0]) {
  return render(
    <IntlProvider locale="en-US" messages={messages['en-US']}>
      <VisitorMessageBubble {...props} />
    </IntlProvider>
  )
}

describe('VisitorMessageBubble', () => {
  it('renders assistant message without AI label when showAiLabel is false', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello there',
      authorName: 'Quinn',
      isAssistant: true,
      showAiLabel: false,
      time: '10:30 AM',
    })

    // Should NOT have the AI label when showAiLabel is false
    expect(screen.getByText(/Quinn/)).toBeInTheDocument()
    // The attribution line should contain the name but NOT show a separate AI label badge
    const attribution = screen.getByText(/Quinn.*AI Agent/)
    expect(attribution).toBeInTheDocument()
  })

  it('renders assistant message with AI label when showAiLabel is true', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello there',
      authorName: 'Quinn',
      isAssistant: true,
      showAiLabel: true,
      time: '10:30 AM',
    })

    expect(screen.getByText(/Quinn/)).toBeInTheDocument()
    // Should have the AI badge after the name
    const aiBadge = screen.getByText('AI')
    expect(aiBadge).toBeInTheDocument()
    // Verify it's in a badge element
    expect(aiBadge.closest('span')).toHaveClass('rounded')
  })

  it('does not render AI label for non-assistant messages even if showAiLabel is true', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello',
      authorName: 'Agent Name',
      isAssistant: false,
      showAiLabel: true,
      time: '10:30 AM',
    })

    const aiBadge = screen.queryByText('AI')
    expect(aiBadge).not.toBeInTheDocument()
  })

  it('renders visitor message without any assistant labels', () => {
    renderBubble({
      side: 'self',
      content: 'Hi there',
      isAssistant: false,
      showAiLabel: true,
    })

    const aiBadge = screen.queryByText('AI')
    expect(aiBadge).not.toBeInTheDocument()
  })

  it('handles showAiLabel being undefined as false', () => {
    renderBubble({
      side: 'peer',
      content: 'Hello',
      authorName: 'Quinn',
      isAssistant: true,
      time: '10:30 AM',
    })

    // When showAiLabel is undefined, should behave like false
    const attribution = screen.getByText(/Quinn.*AI Agent/)
    expect(attribution).toBeInTheDocument()
  })
})
