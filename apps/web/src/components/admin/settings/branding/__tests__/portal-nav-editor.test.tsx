// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedNavEditorItems } from '@/components/public/portal-header-nav'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, string>
    children: ReactNode
  }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search)}` : ''}`} {...rest}>
      {children}
    </a>
  ),
}))

const { PortalNavEditor, servedSectionHosts } = await import('../portal-nav-editor')

describe('servedSectionHosts', () => {
  it('names the hostname each tab is served at: verified ones only', () => {
    const AT = '2026-11-01T00:00:00.000Z'
    expect(
      servedSectionHosts({
        help: { hostname: 'help.acme.com', verifiedAt: AT },
        status: { hostname: 'status.acme.com', verifiedAt: null },
        changelog: { hostname: 'news.acme.com', verifiedAt: AT, unconfirmedSince: AT },
      })
    ).toEqual({ help: 'help.acme.com', changelog: 'news.acme.com' })
  })
})

afterEach(cleanup)

function renderEditor(sectionHosts?: Record<string, string>, linkSectionHosts = false) {
  return render(
    <PortalNavEditor
      items={seedNavEditorItems(null)}
      onChange={vi.fn()}
      gatedTypes={new Set()}
      onReset={vi.fn()}
      sectionHosts={sectionHosts}
      linkSectionHosts={linkSectionHosts}
    />
  )
}

const rowOf = (label: string) =>
  screen.getByLabelText(`Label for ${label}`).closest('[data-slot="nav-row"]') as HTMLElement

describe('portal nav editor', () => {
  it('shows one quiet line with the domain under a tab that has its own', () => {
    renderEditor({ help: 'help.acme.com' })
    expect(rowOf('Help Center')).toHaveTextContent('help.acme.com')
    expect(screen.getAllByText('help.acme.com')).toHaveLength(1)
    expect(rowOf('Status')).not.toHaveTextContent('acme.com')
  })

  it('links the domain line to the Custom domains tab for a viewer who can open it', () => {
    renderEditor({ help: 'help.acme.com' }, true)
    expect(screen.getByRole('link', { name: 'help.acme.com' })).toHaveAttribute(
      'href',
      '/admin/settings/portal?tab=custom-domains'
    )
  })

  it('keeps the domain line plain for a viewer without the Custom domains tab', () => {
    renderEditor({ help: 'help.acme.com' })
    expect(screen.queryByRole('link', { name: 'help.acme.com' })).toBeNull()
    expect(rowOf('Help Center')).toHaveTextContent('help.acme.com')
  })

  it('shows no domain line when no tab has its own', () => {
    renderEditor()
    expect(document.querySelectorAll('[data-slot="nav-row-domain"]')).toHaveLength(0)
  })
})
