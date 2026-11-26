// @vitest-environment happy-dom
/**
 * Ask-a-question facepile: every avatar keeps its initials readable. The
 * overlap stays small and earlier faces stack above later ones, so no avatar
 * covers the initials of the one before it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ user: null, isIdentified: false }),
}))
vi.mock('../use-messenger-summary', () => ({
  useConversationSummary: () => ({ conversation: null, teamName: null, agentsOnline: false }),
}))
vi.mock('../widget-resume-card', () => ({ WidgetResumeCard: () => null }))
vi.mock('../widget-recent-tickets', () => ({ WidgetRecentTicketsCard: () => null }))
vi.mock('../widget-changelog-teaser', () => ({ WidgetChangelogTeaser: () => null }))

import { WidgetOverview } from '../widget-overview'

function renderOverview() {
  const noop = () => {}
  return render(
    <IntlProvider locale="en">
      <WidgetOverview
        tabs={{ messages: true }}
        home={null}
        assistant={{ name: 'Avery Bot', avatarUrl: null }}
        team={[
          { name: 'Blair Cole', avatarUrl: null },
          { name: 'Casey Dunn', avatarUrl: null },
        ]}
        topArticles={[]}
        onLeaveFeedback={noop}
        onOpenHelp={noop}
        onOpenHelpArticle={noop}
        onStartConversation={noop}
        onResumeMessenger={noop}
        onOpenTicket={noop}
        onSeeChangelog={noop}
        onOpenChangelogEntry={noop}
      />
    </IntlProvider>
  )
}

describe('WidgetOverview ask-a-question facepile', () => {
  it('shows two-letter initials on every face', () => {
    const { container } = renderOverview()
    const faces = Array.from(container.querySelectorAll('[data-slot="avatar"]'))
    expect(faces.map((f) => f.textContent)).toEqual(['AB', 'BC', 'CD'])
  })

  it('overlaps faces by at most 4px with a 2px card-coloured ring', () => {
    const { container } = renderOverview()
    const faces = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="avatar"]'))
    const stack = faces[0].parentElement!
    expect(stack.className).toContain('-space-x-1')
    expect(stack.className).not.toMatch(/-space-x-(?!1\b)/)
    for (const face of faces) {
      expect(face.className).toContain('ring-2')
      expect(face.className).toContain('ring-card')
    }
  })

  it('stacks earlier faces above later ones inside their own stacking context', () => {
    const { container } = renderOverview()
    const faces = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="avatar"]'))
    expect(faces[0].parentElement!.className).toContain('isolate')
    const z = faces.map((f) => Number(f.style.zIndex))
    expect(z.every((n) => Number.isFinite(n) && n > 0)).toBe(true)
    for (let i = 1; i < z.length; i++) expect(z[i - 1]).toBeGreaterThan(z[i])
  })
})
