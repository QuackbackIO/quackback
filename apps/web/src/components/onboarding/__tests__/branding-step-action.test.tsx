// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import en from '@/locales/en.json'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string
    search?: Record<string, string>
    children: ReactNode
  }) => (
    <a href={search ? `${to}?${new URLSearchParams(search)}` : to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}))

import { BrandingStepAction } from '../branding-step-action'
import { importDeepLinkSite } from '@/components/admin/settings/portal-customise/import-deep-link'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const EDITOR = '/admin/settings/portal/customise'

function show(domain: string | null) {
  return render(
    <IntlProvider locale="en" messages={en}>
      <BrandingStepAction domain={domain} variant="default" />
    </IntlProvider>
  )
}

describe("the launch plan's brand step", () => {
  it('offers one import from the known company website, and a quiet link to do it by hand', () => {
    show('acme.example')
    expect(screen.getByRole('link', { name: 'Import from acme.example' })).toHaveAttribute(
      'href',
      `${EDITOR}?import=acme.example`
    )
    expect(screen.getByRole('link', { name: 'or customise it yourself' })).toHaveAttribute(
      'href',
      EDITOR
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('asks for the website when none is known, with Import off until one is typed', () => {
    show(null)
    const field = screen.getByRole('textbox', { name: 'Your website' })
    expect(field).toHaveAttribute('placeholder', 'yourcompany.com')
    const button = screen.getByRole('button', { name: 'Import' })
    expect(button).toBeDisabled()
    fireEvent.change(field, { target: { value: '   ' } })
    expect(button).toBeDisabled()
    fireEvent.change(field, { target: { value: ' widgets.example ' } })
    expect(button).toBeEnabled()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: EDITOR,
      search: { import: 'widgets.example' },
    })
    expect(screen.getByRole('link', { name: 'or customise it yourself' })).toHaveAttribute(
      'href',
      EDITOR
    )
  })

  it('says so under the field when what was typed is not a website, and stays put', () => {
    show(null)
    const field = screen.getByRole('textbox', { name: 'Your website' })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(field, { target: { value: 'not a website' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(navigate).not.toHaveBeenCalled()
    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent("That doesn't look like a website")
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', message.id)
    // Typing again clears the message; a real website then goes through.
    fireEvent.change(field, { target: { value: 'widgets.example' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(field).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: EDITOR,
      search: { import: 'widgets.example' },
    })
  })

  it('refuses exactly what the deep link refuses', () => {
    for (const value of ['http://', 'a b.com', 'localhost', 'widgets.example']) {
      cleanup()
      navigate.mockClear()
      show(null)
      fireEvent.change(screen.getByRole('textbox'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))
      const accepted = importDeepLinkSite(value) !== undefined
      expect(navigate.mock.calls.length, value.slice(0, 20)).toBe(accepted ? 1 : 0)
      expect(screen.queryByRole('alert') === null, value.slice(0, 20)).toBe(accepted)
    }
  })

  it('never offers the old logo lookup or a skip of its own', () => {
    show(null)
    for (const gone of ['Find logo', 'Use it', 'Upload a logo', 'Skip'])
      expect(screen.queryByText(gone)).toBeNull()
  })
})
