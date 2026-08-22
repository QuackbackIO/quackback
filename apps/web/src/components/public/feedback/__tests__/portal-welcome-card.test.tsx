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

  it('renders nothing when the body is empty', () => {
    const data: PortalWelcomeCardData = { body: emptyBody }
    const { container } = render(<PortalWelcomeCard welcomeCard={data} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the body is whitespace-only', () => {
    const data: PortalWelcomeCardData = {
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
      },
    }
    const { container } = render(<PortalWelcomeCard welcomeCard={data} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the body when it has visible content', () => {
    render(<PortalWelcomeCard welcomeCard={{ body: richBody }} />)
    expect(screen.getByText(/Tell us what you would like to see next\./)).toBeDefined()
  })
})
