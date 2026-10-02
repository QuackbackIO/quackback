// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { PageHeader } = await import('../page-header')

afterEach(cleanup)

describe('PageHeader', () => {
  it('renders a pane title as an h2 so the page keeps its single h1', () => {
    render(
      <>
        <PageHeader as="h2" title="Settings" />
        <PageHeader title="Boards" />
      </>
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('renders the title as the page heading with the standard sizes', () => {
    render(<PageHeader title="Boards" description="Where posts live" />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Boards' })
    expect(heading.className).toContain('text-xl')
    expect(heading.className).toContain('font-semibold')
    expect(screen.getByText('Where posts live').className).toContain('text-[13px]')
  })

  it('never renders an icon tile', () => {
    const { container } = render(
      // @ts-expect-error icon is not a prop
      <PageHeader title="Boards" icon={() => <svg data-testid="tile" />} />
    )
    expect(container.querySelector('[data-page-header-icon]')).toBeNull()
    expect(screen.queryByTestId('tile')).toBeNull()
  })

  it('renders a logo left of the title and keeps it out of the heading text', () => {
    render(<PageHeader title="Slack" logo={<svg data-testid="logo" />} />)
    expect(screen.getByTestId('logo')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Slack' })).toBeInTheDocument()
  })

  it('renders no breadcrumb row without crumbs', () => {
    render(<PageHeader title="General" />)
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
  })

  it('renders parents as links or muted text and the title as the current page', () => {
    render(
      <PageHeader
        title="Email"
        crumbs={[{ label: 'Support' }, { label: 'Channels', to: '/admin/settings/channels' }]}
      />
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const link = within(nav).getByRole('link', { name: 'Channels' })
    expect(link.getAttribute('href')).toBe('/admin/settings/channels')
    expect(within(nav).queryByRole('link', { name: 'Support' })).toBeNull()
    expect(within(nav).getByText('Support')).toBeInTheDocument()
    const current = within(nav).getByText('Email')
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(within(nav).queryByRole('link', { name: 'Email' })).toBeNull()
  })

  it('renders status left of actions', () => {
    render(
      <PageHeader title="Portal" status={<span>Saved</span>} actions={<button>New board</button>} />
    )
    const status = screen.getByText('Saved')
    const action = screen.getByRole('button', { name: 'New board' })
    expect(status.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lets the title row wrap so badges drop under the title on narrow screens', () => {
    render(
      <PageHeader
        title="Okta"
        logo={<span>logo</span>}
        badge={<span>No client secret</span>}
        actions={<button>Test</button>}
      />
    )
    const row = screen.getByRole('heading', { name: 'Okta' }).parentElement!
    expect(row.className).toContain('flex-wrap')
    expect(row.contains(screen.getByText('No client secret'))).toBe(true)
  })

  it('renders a badge beside the title', () => {
    render(<PageHeader title="Owner" badge={<span>Preset</span>} />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Owner' })
    expect(heading.parentElement?.textContent).toContain('Preset')
    expect(heading.textContent).toBe('Owner')
  })
})
