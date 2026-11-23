// @vitest-environment happy-dom
/**
 * A held post or comment is shown to two people: whoever can review it, and
 * its author. The author is told it waits for review; only the reviewer is
 * told customers cannot see it, and only the reviewer gets the buttons.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import de from '@/locales/de.json'
import { InlineModerationActions } from '../inline-moderation-actions'

afterEach(cleanup)

function renderIn(ui: React.ReactElement, messages: Record<string, string> = {}, locale = 'en') {
  return render(
    <IntlProvider locale={locale} defaultLocale="en" messages={messages}>
      {ui}
    </IntlProvider>
  )
}

describe('InlineModerationActions', () => {
  it('tells the author of a held post it waits for review', () => {
    renderIn(<InlineModerationActions pending noun="post" forAuthor />)
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(
      screen.getByText('Only you can see this post until the team reviews it.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Customers cannot see/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('tells the author of a held comment the same, about the comment', () => {
    renderIn(<InlineModerationActions pending noun="comment" forAuthor />)
    expect(
      screen.getByText('Only you can see this comment until the team reviews it.')
    ).toBeInTheDocument()
  })

  it('keeps the reviewer copy and buttons for someone who can moderate', () => {
    const onApprove = vi.fn()
    renderIn(
      <InlineModerationActions pending noun="comment" onApprove={onApprove} onReject={vi.fn()} />
    )
    expect(screen.getByText('Customers cannot see this comment yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('speaks the reader language', () => {
    renderIn(<InlineModerationActions pending noun="post" forAuthor />, de, 'de')
    expect(screen.getByText(de['portal.moderation.card.authorNote'])).toBeInTheDocument()
  })

  it('renders nothing once the item is no longer held', () => {
    const { container } = renderIn(<InlineModerationActions pending={false} noun="post" />)
    expect(container).toBeEmptyDOMElement()
  })
})
