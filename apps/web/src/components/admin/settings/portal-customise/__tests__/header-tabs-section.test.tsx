// @vitest-environment happy-dom
/**
 * Header and tabs: the name the portal's header shows is its own field. The
 * workspace's name stays where it is set (General) and is only named here.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('../logo-tiles', () => ({
  LogoTiles: ({ workspaceName }: { workspaceName: string }) => (
    <p data-testid="tiles">{workspaceName}</p>
  ),
}))
const navEditor = vi.fn((_props: Record<string, unknown>) => null)
vi.mock('@/components/admin/settings/branding/portal-nav-editor', () => ({
  PortalNavEditor: (props: Record<string, unknown>) => navEditor(props),
}))

const { HeaderTabsSection } = await import('../header-tabs-section')

afterEach(cleanup)

function renderSection(headerName = '') {
  const setHeaderName = vi.fn()
  render(
    <HeaderTabsSection
      workspaceName="Acme Corp"
      headerName={headerName}
      setHeaderName={setHeaderName}
      nav={[]}
      setNav={vi.fn()}
      resetNav={vi.fn()}
      gatedTypes={new Set()}
      logo={{} as never}
    />
  )
  return setHeaderName
}

describe('the name in the header', () => {
  it('is a field of its own, empty while the header shows the workspace name', () => {
    renderSection()
    const field = screen.getByLabelText('Name in the header')
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Acme Corp')
    expect(screen.getByTestId('tiles')).toHaveTextContent('Acme Corp')
  })

  it('says where the workspace name is used and where to change it', () => {
    renderSection('Northwind')
    expect(
      screen.getByText(/Emails and sign-in use the workspace name, Acme Corp\. Change it in/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'General' })).toHaveAttribute(
      'href',
      '/admin/settings/general'
    )
    // The tiles preview the name the header will show.
    expect(screen.getByTestId('tiles')).toHaveTextContent('Northwind')
  })

  it('typing sets the header name only', () => {
    const setHeaderName = renderSection()
    fireEvent.change(screen.getByLabelText('Name in the header'), {
      target: { value: 'Northwind' },
    })
    expect(setHeaderName).toHaveBeenCalledWith('Northwind')
  })
})

describe('the tabs', () => {
  it('show the web address a tab is served at, linked when the viewer has Custom domains', () => {
    render(
      <HeaderTabsSection
        workspaceName="Acme Corp"
        headerName=""
        setHeaderName={vi.fn()}
        nav={[]}
        setNav={vi.fn()}
        resetNav={vi.fn()}
        gatedTypes={new Set()}
        logo={{} as never}
        sectionHosts={{ help: 'help.acme.com' }}
        linkSectionHosts
      />
    )
    expect(navEditor).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionHosts: { help: 'help.acme.com' }, linkSectionHosts: true })
    )
  })
})
