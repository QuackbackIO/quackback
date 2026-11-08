// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render as baseRender, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ChangelogId } from '@quackback/ids'

// BackLink renders a router Link; the detail layout is under test here, not
// navigation, so swap it for a plain anchor.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/b">{children}</a>,
}))
vi.mock('@/components/ui/back-link', () => ({
  BackLink: ({ children }: { children: React.ReactNode }) => <a href="/changelog">{children}</a>,
}))

import { ChangelogEntryDetail } from '../changelog-entry-detail'

const baseProps = {
  id: 'changelog_01h455vb4pex5vsknk084sn02q' as ChangelogId,
  title: 'Dashboards 2.0',
  content: 'A faster dashboard for everyone.',
  contentJson: null,
  publishedAt: '2026-07-01T12:00:00.000Z',
  linkedPosts: [],
}

function render(ui: React.ReactElement) {
  return baseRender(
    <IntlProvider locale="en" defaultLocale="en">
      {ui}
    </IntlProvider>
  )
}

describe('ChangelogEntryDetail featured image', () => {
  it('renders the featured image above the title when one is set', () => {
    render(<ChangelogEntryDetail {...baseProps} featuredImageUrl="/uploads/changelog/hero.png" />)

    const image = screen.getByRole('img', { name: 'Dashboards 2.0' })
    expect(image).toHaveAttribute('src', '/uploads/changelog/hero.png')
  })

  it('renders no image when the entry has no featured image', () => {
    render(<ChangelogEntryDetail {...baseProps} featuredImageUrl={null} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('ChangelogEntryDetail shipped from posts', () => {
  const posts = [
    { id: 'post_1', title: 'Charts', voteCount: 300, boardSlug: 'ideas', status: null },
    { id: 'post_2', title: 'Filters', voteCount: 112, boardSlug: 'ideas', status: null },
  ] as unknown as typeof baseProps.linkedPosts

  it('says how many posts and votes over the posts', () => {
    render(<ChangelogEntryDetail {...baseProps} featuredImageUrl={null} linkedPosts={posts} />)
    expect(screen.getByText('From 2 posts · 412 votes')).toBeInTheDocument()
    expect(screen.getByText('Charts')).toBeInTheDocument()
  })

  it('leaves them off when the design hides them', () => {
    render(
      <ChangelogEntryDetail
        {...baseProps}
        featuredImageUrl={null}
        linkedPosts={posts}
        shipped={false}
      />
    )
    expect(screen.queryByText('Charts')).not.toBeInTheDocument()
    expect(screen.queryByText(/From 2 posts/)).not.toBeInTheDocument()
  })
})
