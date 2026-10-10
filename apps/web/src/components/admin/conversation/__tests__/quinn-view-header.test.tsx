// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const hoisted = vi.hoisted(() => ({ canManage: true }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (key: string) => key === 'assistant.manage' && hoisted.canManage,
}))

const { QuinnViewHeader } = await import('../quinn-view-header')

afterEach(cleanup)

describe('QuinnViewHeader', () => {
  it('links an assistant manager to the Agent settings', () => {
    hoisted.canManage = true
    render(<QuinnViewHeader onChange={() => {}} />)
    expect(screen.getByRole('link', { name: 'Configure the agent' }).getAttribute('href')).toBe(
      '/admin/settings/agent'
    )
  })

  it('shows no link to someone who cannot manage the assistant', () => {
    hoisted.canManage = false
    render(<QuinnViewHeader onChange={() => {}} />)
    expect(screen.queryByRole('link', { name: 'Configure the agent' })).toBeNull()
  })

  it('keeps the outcome filters, with counts', () => {
    hoisted.canManage = false
    const onChange = vi.fn()
    render(
      <QuinnViewHeader counts={{ resolved: 4, escalated: 2, pending: 1 }} onChange={onChange} />
    )
    expect(screen.getByRole('button', { name: /All\s*7/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Escalated\s*2/ }))
    expect(onChange).toHaveBeenCalledWith('escalated')
  })
})
