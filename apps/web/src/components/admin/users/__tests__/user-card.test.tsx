// @vitest-environment happy-dom
/**
 * <UserCard> — row in the admin Users list.
 *
 * Covers:
 *   - Clicking the row selects the user for the detail panel
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserCard } from '../user-card'
import type { PortalUserListItemView } from '@/lib/shared/types'
import type { PrincipalId } from '@quackback/ids'

const USER: PortalUserListItemView = {
  principalId: 'principal_1' as PrincipalId,
  userId: 'user_1',
  name: 'Dana Lee',
  email: 'dana@example.com',
  image: null,
  emailVerified: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  postCount: 0,
  commentCount: 0,
  voteCount: 0,
  segments: [],
  metadata: null,
  isLead: false,
  contactEmail: null,
  lastSeenAt: null,
  country: 'US',
}

describe('<UserCard>', () => {
  it('calls onClick when the row is clicked', () => {
    const onClick = vi.fn()
    render(<UserCard user={USER} isSelected={false} onClick={onClick} />)
    fireEvent.click(screen.getByText('Dana Lee'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hides the country field by default', () => {
    render(<UserCard user={USER} isSelected={false} onClick={vi.fn()} />)
    expect(screen.queryByText('United States')).toBeNull()
  })

  it('shows the country field when showCountry is on and the user has one', () => {
    render(<UserCard user={USER} isSelected={false} onClick={vi.fn()} showCountry />)
    expect(screen.getByText('United States')).toBeInTheDocument()
  })

  it('shows a placeholder when showCountry is on but the user has no country', () => {
    render(
      <UserCard
        user={{ ...USER, country: null }}
        isSelected={false}
        onClick={vi.fn()}
        showCountry
      />
    )
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('shows the post, comment and vote counts as labelled values, not bare icons', () => {
    render(
      <UserCard
        user={{ ...USER, postCount: 3, commentCount: 5, voteCount: 2 }}
        isSelected={false}
        onClick={vi.fn()}
      />
    )
    expect(screen.getByTitle('Posts')).toHaveTextContent('3')
    expect(screen.getByTitle('Comments')).toHaveTextContent('5')
    expect(screen.getByTitle('Votes')).toHaveTextContent('2')
  })

  it('shows the counts even when they are zero, so the column stays scannable across rows', () => {
    render(<UserCard user={USER} isSelected={false} onClick={vi.fn()} />)
    expect(screen.getByTitle('Posts')).toHaveTextContent('0')
    expect(screen.getByTitle('Comments')).toHaveTextContent('0')
    expect(screen.getByTitle('Votes')).toHaveTextContent('0')
  })

  it('surfaces last-seen as a tooltip on the joined cell rather than a second visible line', () => {
    render(
      <UserCard
        user={{ ...USER, lastSeenAt: '2026-02-01T00:00:00.000Z' }}
        isSelected={false}
        onClick={vi.fn()}
      />
    )
    expect(screen.getByTitle(/Last seen/)).toBeInTheDocument()
  })
})
