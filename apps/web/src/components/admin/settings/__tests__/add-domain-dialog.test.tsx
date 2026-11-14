// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const addDomain = vi.fn()
vi.mock('@/lib/server/functions/domains', () => ({ addDomainFn: addDomain }))

const { AddDomainButton } = await import('../add-domain-dialog')

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

function open() {
  render(<AddDomainButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Add domain' }))
  return screen.getByRole('dialog')
}

describe('add domain', () => {
  it('asks for the name only, then opens the new domain page', async () => {
    addDomain.mockResolvedValue({ name: 'acme.com' })
    const dialog = open()
    // One field: no choice of what the domain is for.
    expect(dialog.querySelectorAll('input')).toHaveLength(1)
    expect(dialog.querySelectorAll('[role="radio"], select')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: ' ACME.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/admin/settings/domains/$domain',
        params: { domain: 'acme.com' },
      })
    )
    expect(addDomain).toHaveBeenCalledWith({ data: { name: 'ACME.com' } })
  })

  it('says why a name was refused and stays open', async () => {
    addDomain.mockRejectedValue(
      new ValidationError('INVALID_DOMAIN', 'Must be a public FQDN (e.g. "acme.com")')
    )
    open()
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'localhost' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Must be a public FQDN')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
