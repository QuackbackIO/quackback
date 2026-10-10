// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const { BoardsList } = await import('../boards-list')

afterEach(cleanup)

const PUBLIC: BoardAccess = {
  view: 'anonymous',
  vote: 'authenticated',
  comment: 'authenticated',
  submit: 'authenticated',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}
const PRIVATE: BoardAccess = {
  ...PUBLIC,
  view: 'team',
  vote: 'team',
  comment: 'team',
  submit: 'team',
}
const SEGMENTED: BoardAccess = {
  ...PUBLIC,
  view: 'segments',
  segments: { view: ['seg_1'], vote: [], comment: [], submit: [] },
}

function board(over: Record<string, unknown>) {
  return {
    id: 'board_1',
    slug: 'one',
    name: 'One',
    description: null,
    access: PUBLIC,
    postCount: 0,
    ...over,
  } as never
}

describe('BoardsList', () => {
  it('shows no access badge for a board open to the portal', () => {
    render(<BoardsList boards={[board({ access: PUBLIC })]} />)
    expect(screen.queryByText('Team only')).toBeNull()
    expect(screen.queryByText('Segments')).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('marks team-only and segment boards', () => {
    render(
      <BoardsList
        boards={[
          board({ id: 'b2', slug: 'priv', name: 'Priv', access: PRIVATE }),
          board({ id: 'b3', slug: 'seg', name: 'Seg', access: SEGMENTED }),
        ]}
      />
    )
    expect(screen.getByText('Team only')).toBeTruthy()
    expect(screen.getByText('Segments')).toBeTruthy()
    expect(screen.queryByText('Custom')).toBeNull()
  })

  it('renders every row as a link to the board with the description and post count on one meta line', () => {
    render(
      <BoardsList
        boards={[
          board({ slug: 'bugs', name: 'Bugs', description: 'Report problems', postCount: 6 }),
          board({ id: 'b2', slug: 'ideas', name: 'Ideas', description: null, postCount: 1 }),
        ]}
      />
    )
    const bugs = screen.getByText('Bugs').closest('a')!
    expect(bugs.getAttribute('href')).toBe('/admin/settings/boards/$slug')
    expect(within(bugs).getByText('Report problems · 6 posts')).toBeTruthy()
    const ideas = screen.getByText('Ideas').closest('a')!
    expect(within(ideas).getByText('1 post')).toBeTruthy()
    expect(document.querySelectorAll('[data-slot="settings-list-chevron"]')).toHaveLength(2)
  })

  it('has no third badge: a board narrower than the portal without segments stays quiet', () => {
    const OPEN: BoardAccess = {
      ...PUBLIC,
      vote: 'anonymous',
      comment: 'anonymous',
      submit: 'anonymous',
    }
    const SIGNED_IN_ONLY: BoardAccess = { ...PUBLIC, view: 'authenticated' }
    render(
      <BoardsList
        boards={[
          board({ id: 'b2', slug: 'open', name: 'Open board', access: OPEN }),
          board({ id: 'b3', slug: 'signed', name: 'Signed board', access: SIGNED_IN_ONLY }),
        ]}
      />
    )
    expect(screen.queryByText('Restricted')).toBeNull()
  })

  it('marks a board whose view is team only even when actions differ', () => {
    render(
      <BoardsList
        boards={[board({ slug: 'staff', name: 'Staff', access: { ...PUBLIC, view: 'team' } })]}
      />
    )
    expect(screen.getByText('Team only')).toBeTruthy()
  })

  it('treats the default access as open', () => {
    render(<BoardsList boards={[board({ access: DEFAULT_BOARD_ACCESS })]} />)
    expect(screen.queryByText('Team only')).toBeNull()
  })
})
