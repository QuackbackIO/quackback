// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { DefaultErrorPage, isAuthorizationError, isEntitlementError } from '../error-page'

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

describe('isEntitlementError', () => {
  it('flags a named plan refusal', () => {
    expect(
      isEntitlementError(
        new Error(
          'The audit log is a Scale feature. Your workspace is on Pro. Upgrade to Scale to enable it.'
        )
      )
    ).toBe(true)
    expect(
      isEntitlementError(
        new Error('Workflows are not included in your plan. Contact us to enable it.')
      )
    ).toBe(true)
  })

  it('ignores unrelated runtime errors', () => {
    expect(isEntitlementError(new Error('boom'))).toBe(false)
    expect(isEntitlementError(new Error('Access denied: Requires [admin], got member'))).toBe(false)
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

  it('does not treat a plan refusal as an unexpected crash', () => {
    render(
      <DefaultErrorPage
        error={
          new Error(
            'The audit log is a Scale feature. Your workspace is on Pro. Upgrade to Scale to enable it.'
          )
        }
      />
    )

    expect(screen.queryByText(/Something went wrong/i)).toBeNull()
    expect(screen.queryByText(/Technical details/i)).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'The audit log is available from the Scale plan' })
    ).toBeInTheDocument()
    expect(screen.getByText(/The audit log is a Scale feature/)).toBeInTheDocument()
  })

  it('keeps the generic plan headline when the refusal names no plan', () => {
    render(
      <DefaultErrorPage
        error={new Error('Workflows are not included in your plan. Contact us to enable it.')}
      />
    )

    expect(screen.getByRole('heading', { name: 'This is a plan feature' })).toBeInTheDocument()
  })
})
