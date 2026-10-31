// @vitest-environment happy-dom
/**
 * An empty state's title sits one level below the heading of what it is in,
 * so a page's headings step down one at a time.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { InboxIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '../empty-state'

afterEach(cleanup)

describe('an empty state', () => {
  it('titles itself at the third level by default, and at the level it is given', () => {
    render(<EmptyState icon={InboxIcon} title="Nothing here" />)
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeTruthy()
    cleanup()
    render(<EmptyState icon={InboxIcon} title="Sign in" heading="h2" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Sign in' })).toBeTruthy()
  })
})
