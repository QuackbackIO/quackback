// @vitest-environment happy-dom
/**
 * <UserCard> — row in the admin Users list.
 *
 * Covers:
 *   - Clicking the row selects the user for the detail panel
 *   - The selection checkbox toggles bulk-selection without opening the detail panel
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
}

describe('<UserCard>', () => {
  it('calls onClick when the row is clicked', () => {
    const onClick = vi.fn()
    render(
      <UserCard
        user={USER}
        isSelected={false}
        onClick={onClick}
        checked={false}
        onToggleCheck={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('Dana Lee'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('reflects the checked prop on the selection checkbox', () => {
    render(
      <UserCard user={USER} isSelected={false} onClick={vi.fn()} checked onToggleCheck={vi.fn()} />
    )
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('clicking the checkbox calls onToggleCheck without triggering onClick', () => {
    const onClick = vi.fn()
    const onToggleCheck = vi.fn()
    render(
      <UserCard
        user={USER}
        isSelected={false}
        onClick={onClick}
        checked={false}
        onToggleCheck={onToggleCheck}
      />
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleCheck).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })
})
