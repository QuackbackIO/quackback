// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { PortalPreview } from '../portal-preview'

afterEach(cleanup)

function renderPreview(props: {
  name: string
  goals?: OnboardingOutcome[]
  variant?: 'example' | 'goals' | 'live'
}) {
  return render(
    <IntlProvider locale="en">
      <PortalPreview hostname="feedback.fernhill.example" {...props} />
    </IntlProvider>
  )
}

/** The tab labels the mock shows, in order. */
function tabs(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-preview-tab]')].map((tab) => tab.textContent ?? '')
}

describe('portal preview', () => {
  // The mock is a picture of a portal: assistive tech gets one sentence about
  // it, not invented headings and ideas read out as content.
  it('is decorative for assistive tech, with one sentence describing it', () => {
    const { container } = renderPreview({
      name: 'Fernhill',
      goals: ['product_feedback', 'help_center'],
    })

    const frame = container.querySelector('[aria-hidden="true"]')
    expect(frame).not.toBeNull()
    expect(frame).toHaveTextContent('Fernhill')
    expect(container.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(0)
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    const description = screen.getByText(
      'Portal preview for Fernhill. Tabs: Feedback, Roadmap, Changelog, and Help center.'
    )
    expect(description).toHaveClass('sr-only')
    expect(frame?.contains(description)).toBe(false)
  })

  it('reads naturally before a name is typed', () => {
    const { container } = renderPreview({ name: '', variant: 'example' })
    expect(screen.getByText('What should we build next?')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Your workspace build/)
    cleanup()

    const goals = renderPreview({ name: '', goals: ['product_feedback'] })
    expect(screen.getByText('Your team reads every request.')).toBeInTheDocument()
    expect(goals.container.textContent).not.toMatch(/The Your workspace team/)
  })

  // Sample ideas are an illustration of a busy portal, and only appear where
  // the screen says it is an example.
  it('keeps sample ideas to the example', () => {
    renderPreview({ name: 'Fernhill', variant: 'example' })
    expect(screen.getByText('Dark mode')).toBeInTheDocument()
    cleanup()

    renderPreview({ name: 'Fernhill', goals: ['product_feedback'] })
    expect(screen.queryByText('Dark mode')).toBeNull()
    expect(screen.getByText('Got an idea? Be the first to share it')).toBeInTheDocument()
  })

  // On the ready step the portal is live, so the preview shows it as it is:
  // the empty board under the workspace's own name, and only its real tabs.
  it('shows the live portal as it really is', () => {
    const { container } = renderPreview({
      name: 'Fernhill',
      variant: 'live',
      goals: ['product_feedback', 'customer_support', 'help_center', 'status_page'],
    })

    expect(tabs(container)).toEqual([
      'Feedback',
      'Roadmap',
      'Changelog',
      'Help center',
      'Support',
      'Status',
    ])
    expect(screen.getByText('Got an idea? Be the first to share it')).toBeInTheDocument()
    expect(screen.getByText('The Fernhill team reads every request.')).toBeInTheDocument()
    expect(screen.queryByText('Dark mode')).toBeNull()
    // The live portal has no Messenger launcher, so neither does its preview.
    expect(screen.queryByText('Hi there. How can we help?')).toBeNull()
  })

  it('has only the tabs the workspace will have', () => {
    const { container } = renderPreview({
      name: 'Fernhill',
      variant: 'live',
      goals: ['help_center'],
    })

    // Changelog comes with Feedback as a goal; without it there is none.
    expect(tabs(container)).toEqual(['Feedback', 'Roadmap', 'Help center'])
  })

  it('shows Messenger while choosing, when Support is picked', () => {
    renderPreview({ name: 'Fernhill', goals: ['customer_support'] })
    expect(screen.getByText('Hi there. How can we help?')).toBeInTheDocument()
  })
})
