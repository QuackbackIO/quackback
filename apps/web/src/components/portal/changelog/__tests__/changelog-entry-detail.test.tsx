// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChangelogId } from '@quackback/ids'

// BackLink renders a router Link; the detail layout is under test here, not
// navigation, so swap it for a plain anchor.
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
