// @vitest-environment happy-dom
/**
 * An empty welcome message renders nothing on the portal. In the admin
 * preview's edit mode it leaves a target to click, so the admin can open the
 * section from the page itself.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PortalWelcomeCard } from '../feedback/portal-welcome-card'
import { PreviewEditModeProvider } from '../preview-draft-context'

afterEach(cleanup)

const empty = { body: { type: 'doc', content: [{ type: 'paragraph' }] } }

describe('PortalWelcomeCard', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<PortalWelcomeCard welcomeCard={empty} />)
    expect(container.innerHTML).toBe('')
  })

  it('leaves an empty target in the preview edit mode', () => {
    const { container } = render(
      <PreviewEditModeProvider labels={{ welcome: 'Welcome message' }}>
        <PortalWelcomeCard welcomeCard={empty} />
      </PreviewEditModeProvider>
    )
    const target = container.querySelector('[data-qb-edit="welcome"]')
    expect(target).not.toBeNull()
    expect(target?.textContent).toBe('Welcome message')
  })

  it('marks a shown message as a target', () => {
    const { container } = render(
      <PortalWelcomeCard
        welcomeCard={{
          body: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
          },
        }}
      />
    )
    expect(container.querySelector('[data-qb-edit="welcome"]')).not.toBeNull()
  })
})
