// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoginPage } from '../auth.login'

vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig()),
  Link: (p: any) => <a href={p.to}>{p.children}</a>,
}))

describe('/auth/login team callback', () => {
  it('renders the team form (email + recovery) for /admin callbackUrl', () => {
    render(<LoginPage __test={{ safeCallbackUrl: '/admin', isTeam: true }} />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByText(/recovery code/i)).toBeInTheDocument()
  })
})
