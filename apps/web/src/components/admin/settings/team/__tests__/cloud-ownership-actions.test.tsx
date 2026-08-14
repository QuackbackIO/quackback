// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CloudOwnershipActions } from '../cloud-ownership-actions'

const { mockBillingEnabled, mockOwner } = vi.hoisted(() => ({
  mockBillingEnabled: { current: false },
  mockOwner: { current: 'owner@example.com' as string | null },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ billingEnabled: mockBillingEnabled.current }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockOwner.current }),
}))

vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))

vi.mock('@/lib/server/functions/ownership', () => ({
  getCloudOwnerEmailFn: vi.fn(),
  leaveCloudWorkspaceFn: vi.fn(),
  transferWorkspaceOwnershipFn: vi.fn(),
}))

describe('CloudOwnershipActions', () => {
  afterEach(() => {
    mockBillingEnabled.current = false
    mockOwner.current = 'owner@example.com'
    cleanup()
  })

  it('is absent when cloud is off', () => {
    mockBillingEnabled.current = false
    const { container } = render(
      <CloudOwnershipActions
        sessionEmail="owner@example.com"
        memberEmails={['owner@example.com', 'mate@example.com']}
      />
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('lets the owner transfer and does not offer leave', () => {
    mockBillingEnabled.current = true
    render(
      <CloudOwnershipActions
        sessionEmail="owner@example.com"
        memberEmails={['owner@example.com', 'mate@example.com']}
      />
    )
    expect(screen.getByRole('button', { name: 'Transfer ownership' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Leave workspace' })).toBeNull()
  })

  it('lets a non-owner leave', () => {
    mockBillingEnabled.current = true
    render(
      <CloudOwnershipActions
        sessionEmail="mate@example.com"
        memberEmails={['owner@example.com', 'mate@example.com']}
      />
    )
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).toBeNull()
  })
})
