// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PortalWelcomeCard } from '../portal-welcome-card'
import type { PortalWelcomeCard as PortalWelcomeCardData } from '@/lib/shared/types/settings'

const emptyBody = { type: 'doc', content: [{ type: 'paragraph' }] }

const richBody = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Tell us what you would like to see next.' }],
    },
  ],
}

describe('<PortalWelcomeCard>', () => {
  it('renders nothing when welcomeCard is undefined', () => {
    const { container } = render(<PortalWelcomeCard welcomeCard={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when disabled', () => {
    const data: PortalWelcomeCardData = {
      enabled: false,
      title: 'Share your product feedback!',
      body: richBody,
    }
    const { container } = render(<PortalWelcomeCard welcomeCard={data} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when enabled but title and body are both empty', () => {
    const data: PortalWelcomeCardData = {
      enabled: true,
      title: '   ',
      body: emptyBody,
    }
    const { container } = render(<PortalWelcomeCard welcomeCard={data} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders title only when body is empty', () => {
    const data: PortalWelcomeCardData = {
      enabled: true,
      title: 'Share your product feedback!',
      body: emptyBody,
    }
    render(<PortalWelcomeCard welcomeCard={data} />)
    expect(screen.getByRole('heading', { name: 'Share your product feedback!' })).toBeDefined()
  })

  it('renders body only when title is empty', () => {
    const data: PortalWelcomeCardData = {
      enabled: true,
      title: '',
      body: richBody,
    }
    render(<PortalWelcomeCard welcomeCard={data} />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText(/Tell us what you would like to see next\./)).toBeDefined()
  })

  it('renders both title and body when both are populated', () => {
    const data: PortalWelcomeCardData = {
      enabled: true,
      title: 'Share your product feedback!',
      body: richBody,
    }
    render(<PortalWelcomeCard welcomeCard={data} />)
    expect(screen.getByRole('heading', { name: 'Share your product feedback!' })).toBeDefined()
    expect(screen.getByText(/Tell us what you would like to see next\./)).toBeDefined()
  })
})
