// @vitest-environment happy-dom
/**
 * AssistantAnswer / CitationDot: pins the existing (non-internal) citation
 * rendering byte-for-byte, then covers the additive internal-source styling
 * the Copilot leak gate relies on (COPILOT-SIDEBAR-UX.md B.4) — an amber tint
 * + lock badge on the pill, and an "Internal" hovercard tag in place of a URL
 * host when the citation carries no public url.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AssistantAnswer, type RenderableCitation } from '../assistant-turn'
import type { ConversationMessageCitation } from '@/lib/shared/conversation/types'

const publicCitation: ConversationMessageCitation = {
  type: 'article',
  id: 'article_1',
  title: 'Resetting your password',
  url: 'https://help.example.com/reset',
}

// `internal` is render-path-only (never on the persisted ConversationMessageCitation —
// see conversation/types.ts), so an internal-sourced fixture is typed as the
// component's own RenderableCitation superset, exactly like a live CopilotCitation
// or AssistantCitation would be at render time.
const internalCitation: RenderableCitation = {
  type: 'snippet',
  id: 'snippet_1',
  title: 'Refund policy (internal)',
  url: '',
  internal: true,
}

describe('<AssistantAnswer> citations', () => {
  it('renders a non-internal citation exactly as before: no amber classes, no lock badge', () => {
    const { container } = render(
      <AssistantAnswer text="Reset it here [1]." citations={[publicCitation]} />
    )

    const dot = container.querySelector('a[aria-label="Source 1: Resetting your password"]')
    expect(dot).not.toBeNull()
    expect(dot?.className).not.toMatch(/amber/)
    // No lock badge anywhere near the dot (the internal-only corner glyph).
    expect(container.querySelector('.bg-amber-500')).not.toBeInTheDocument()
  })

  it('gives an internal citation the amber tint + lock badge on the pill', () => {
    const { container } = render(
      <AssistantAnswer text="Refunds go here [1]." citations={[internalCitation]} />
    )

    const dot = container.querySelector(
      'a[aria-label="Internal source 1: Refund policy (internal)"]'
    )
    expect(dot).not.toBeNull()
    expect(dot?.className).toMatch(/amber/)
    expect(container.querySelector('.bg-amber-500')).toBeInTheDocument()
  })

  it("shows an 'Internal' hovercard tag instead of a URL host when an internal citation has no url", () => {
    render(<AssistantAnswer text="Refunds go here [1]." citations={[internalCitation]} />)

    expect(screen.getByText('Internal')).toBeInTheDocument()
  })

  it('keeps showing the URL host in the hovercard for a public (non-internal) citation', () => {
    render(<AssistantAnswer text="Reset it here [1]." citations={[publicCitation]} />)

    expect(screen.getByText('help.example.com')).toBeInTheDocument()
    expect(screen.queryByText('Internal')).not.toBeInTheDocument()
  })

  it('an internal citation that DOES carry a url still shows the host, not the Internal tag', () => {
    const internalWithUrl: RenderableCitation = {
      ...internalCitation,
      url: 'https://internal.example.com/doc',
    }
    render(<AssistantAnswer text="See here [1]." citations={[internalWithUrl]} />)

    expect(screen.getByText('internal.example.com')).toBeInTheDocument()
    expect(screen.queryByText('Internal')).not.toBeInTheDocument()
  })
})

describe('<AssistantAnswer> hovercard freshness line', () => {
  const EIGHT_DAYS_AGO = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()

  it('renders "Updated … ago" when the citation carries updatedAt', () => {
    const cited: RenderableCitation = { ...publicCitation, updatedAt: EIGHT_DAYS_AGO }
    const { container } = render(<AssistantAnswer text="Reset it here [1]." citations={[cited]} />)

    expect(container.textContent).toMatch(/Updated 8 days ago/)
  })

  it('renders no freshness line when updatedAt is absent (exactly as before)', () => {
    const { container } = render(
      <AssistantAnswer text="Reset it here [1]." citations={[publicCitation]} />
    )

    expect(container.textContent).not.toMatch(/Updated/)
  })

  it('renders no freshness line for an unparseable updatedAt', () => {
    const cited: RenderableCitation = { ...publicCitation, updatedAt: 'not-a-date' }
    const { container } = render(<AssistantAnswer text="Reset it here [1]." citations={[cited]} />)

    expect(container.textContent).not.toMatch(/Updated/)
  })

  it('still shows the freshness line alongside the Internal tag on an internal citation', () => {
    const cited: RenderableCitation = { ...internalCitation, updatedAt: EIGHT_DAYS_AGO }
    const { container } = render(
      <AssistantAnswer text="Refunds go here [1]." citations={[cited]} />
    )

    expect(screen.getByText('Internal')).toBeInTheDocument()
    expect(container.textContent).toMatch(/Updated 8 days ago/)
  })
})
