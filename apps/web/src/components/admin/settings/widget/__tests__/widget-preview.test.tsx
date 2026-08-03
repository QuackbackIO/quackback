// @vitest-environment happy-dom
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * Covers the Chat tab integration (the preview must mirror the real widget's
 * tab set so admins see an accurate representation):
 *   - A chat-only config renders the chat view ("Chat with us" heading) and
 *     reflects the configured teamName + welcomeMessage, with no tab bar.
 *   - With multiple tabs enabled, a "Chat" tab button appears and selecting it
 *     switches to the chat view.
 *   - Chat is not rendered when tabs.chat is off.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetPreview } from '../widget-preview'

describe('WidgetPreview — chat tab', () => {
  it('renders the chat view with configured team name + welcome message when chat is the only tab', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, chat: true }}
        chat={{ teamName: 'Acme Support', welcomeMessage: 'Hi! How can we help you today?' }}
      />
    )

    expect(screen.getByText('Chat with us')).toBeTruthy()
    expect(screen.getByText('Hi! How can we help you today?')).toBeTruthy()
    expect(screen.getByText('Acme Support')).toBeTruthy()
    // Single tab → no tab bar.
    expect(screen.queryByRole('button', { name: /Chat tab/i })).toBeNull()
  })

  it('exposes a Chat tab and switches to the chat view when selected', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: false, help: false, chat: true }}
        chat={{ teamName: 'Acme Support', welcomeMessage: 'Welcome aboard!' }}
      />
    )

    // Starts on feedback.
    expect(screen.getByText('Share your ideas')).toBeTruthy()

    const chatTab = screen.getByRole('button', { name: /Chat tab/i })
    fireEvent.click(chatTab)

    expect(screen.getByText('Chat with us')).toBeTruthy()
    expect(screen.getByText('Welcome aboard!')).toBeTruthy()
  })

  it('does not render the chat view when chat tab is off', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: true, help: false, chat: false }}
        chat={{ teamName: 'Acme Support', welcomeMessage: 'Welcome aboard!' }}
      />
    )

    expect(screen.queryByText('Chat with us')).toBeNull()
    expect(screen.queryByRole('button', { name: /Chat tab/i })).toBeNull()
  })

  it('renders the availability presence strip in the chat view (mirrors the real widget)', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, chat: true }}
        chat={{ teamName: 'Acme Support', welcomeMessage: 'Hi!' }}
      />
    )

    expect(screen.getByText(/We're online/i)).toBeTruthy()
  })

  it('shows the empty-state prompt instead of a fabricated greeting when no welcome message is set', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, chat: true }}
        chat={{ teamName: 'Acme Support', welcomeMessage: '' }}
      />
    )

    // The real widget shows the empty-state prompt — not an invented greeting.
    expect(screen.getByText(/Send us a message/i)).toBeTruthy()
    expect(screen.queryByText(/How can we help/i)).toBeNull()
  })

  it('omits the agent name label when no team name is configured (matches the real ChatBubble)', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, chat: true }}
        chat={{ welcomeMessage: 'Hello there' }}
      />
    )

    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.queryByText('Support')).toBeNull()
  })

  it('renders the support ticket entry when ticketing is enabled', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: false, help: false, chat: false }}
        ticketingEnabled
      />
    )

    expect(screen.getByText('Contact support')).toBeTruthy()
    expect(screen.getByText('Get help directly from our team.')).toBeTruthy()
  })

  it('does not render the support ticket entry when ticketing is disabled', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: false, help: false, chat: false }}
        ticketingEnabled={false}
      />
    )

    expect(screen.queryByText('Contact support')).toBeNull()
  })
})
