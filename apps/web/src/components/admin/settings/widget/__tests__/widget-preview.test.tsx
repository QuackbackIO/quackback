// @vitest-environment happy-dom
/**
 * <WidgetPreview> — admin widget settings live preview.
 *
 * The preview must mirror the real widget's nav model (widget-nav.ts) so admins
 * see an accurate representation:
 *   - Tab order is Home | Messages | Feedback | Help | Changelog, with Home only
 *     when 2+ surfaces are enabled.
 *   - The Messages tab renders the conversation list fronted by the assistant
 *     identity (or the team name when the assistant is off).
 *   - A messages-only config renders the list with no tab bar.
 *   - Home renders the customised greeting and the ordered card list.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WidgetPreview } from '../widget-preview'

describe('WidgetPreview — messages tab', () => {
  it('renders the conversation list with no tab bar when messages is the only surface', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, messenger: true }}
        teamName="Acme Support"
      />
    )

    // List rows are fronted by the team name (no assistant configured).
    expect(screen.getAllByText('Acme Support').length).toBeGreaterThan(0)
    expect(screen.getByText('Ask a question')).toBeTruthy()
    // Single tab → no tab bar.
    expect(screen.queryByRole('button', { name: /Messages tab/i })).toBeNull()
  })

  it('fronts the conversation list with the assistant identity when enabled', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: false, changelog: false, help: false, messenger: true }}
        assistant={{ enabled: true, name: 'Quinn' }}
        teamName="Acme Support"
      />
    )

    expect(screen.getAllByText('Quinn').length).toBeGreaterThan(0)
    expect(screen.queryByText('Acme Support')).toBeNull()
  })

  it('exposes a Messages tab and switches to the list when selected', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: false, help: false, messenger: true, home: false }}
        teamName="Acme Support"
      />
    )

    // Starts on the first surface (messages is first in the order).
    expect(screen.getByRole('button', { name: /Feedback tab/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Feedback tab/i }))
    expect(screen.getByText('Share your ideas')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Messages tab/i }))
    expect(screen.getByText('Ask a question')).toBeTruthy()
  })

  it('does not render a Messages tab when messenger is off', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: true, help: false, messenger: false }}
      />
    )

    expect(screen.queryByRole('button', { name: /Messages tab/i })).toBeNull()
  })
})

describe('WidgetPreview — home tab', () => {
  it('shows Home first with 2+ surfaces and renders the customised greeting', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: true, help: false, messenger: false }}
        home={{ greeting: 'Welcome to Acme 👋', subtitle: 'We are here for you' }}
      />
    )

    // Home is the initial tab, so its hero renders immediately.
    expect(screen.getByText('Welcome to Acme 👋')).toBeTruthy()
    expect(screen.getByText('We are here for you')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Home tab/i })).toBeTruthy()
  })

  it('renders ordered custom cards and skips cards for disabled surfaces', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: true, help: false, messenger: false }}
        home={{
          cards: [
            { id: 'c1', type: 'link', title: 'Book a demo', url: 'https://example.com' },
            { id: 'c2', type: 'feedback' },
            // Help is disabled, so this card must not render.
            { id: 'c3', type: 'article_search' },
          ],
        }}
      />
    )

    expect(screen.getByText('Book a demo')).toBeTruthy()
    expect(screen.getByText('Suggest a feature')).toBeTruthy()
    expect(screen.queryByText('Get help')).toBeNull()
  })

  it('hides Home when the admin disables it', () => {
    render(
      <WidgetPreview
        position="bottom-right"
        tabs={{ feedback: true, changelog: true, help: false, messenger: false, home: false }}
      />
    )

    expect(screen.queryByRole('button', { name: /Home tab/i })).toBeNull()
    // Lands on feedback instead.
    expect(screen.getByText('Share your ideas')).toBeTruthy()
  })
})
