// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { DefaultErrorPage, isAuthorizationError } from '../error-page'

describe('isAuthorizationError', () => {
  it('flags the role-gate failures thrown by requireAuth', () => {
    expect(isAuthorizationError(new Error('Access denied: Requires [admin], got member'))).toBe(
      true
    )
    expect(isAuthorizationError(new Error('Access denied: Not a team member'))).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isAuthorizationError(new Error('Network request failed'))).toBe(false)
    expect(isAuthorizationError(new Error('undefined is not a function'))).toBe(false)
  })
})

describe('DefaultErrorPage', () => {
  afterEach(() => cleanup())

  it('shows a friendly permission notice for authorization errors', () => {
    render(<DefaultErrorPage error={new Error('Access denied: Requires [admin], got member')} />)

    expect(screen.getByText(/don't have access/i)).toBeInTheDocument()
    // The raw role-gate jargon must never reach the user.
    expect(screen.queryByText(/Requires \[admin\]/)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
  })

  it('keeps the generic error treatment for everything else', () => {
    render(<DefaultErrorPage error={new Error('boom')} />)

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/Technical details/i)).toBeInTheDocument()
  })
})
