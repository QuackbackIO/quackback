// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { TrustedSendersCard } from '../trusted-senders-card'

const ENTRIES = ['jane@acme.com', 'partner.io']

describe('<TrustedSendersCard>', () => {
  const onSave = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    onSave.mockResolvedValue(undefined)
  })

  it('lists the current trusted entries', () => {
    render(<TrustedSendersCard entries={ENTRIES} onSave={onSave} />)
    expect(screen.getByText('jane@acme.com')).toBeTruthy()
    expect(screen.getByText('partner.io')).toBeTruthy()
  })

  it('adds a normalized entry via the Add button', async () => {
    render(<TrustedSendersCard entries={ENTRIES} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/add trusted sender/i), {
      target: { value: '  Bob@Example.COM ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([...ENTRIES, 'bob@example.com']))
  })

  it('adds an entry on Enter', async () => {
    render(<TrustedSendersCard entries={[]} onSave={onSave} />)
    const input = screen.getByLabelText(/add trusted sender/i)
    fireEvent.change(input, { target: { value: 'acme.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['acme.com']))
  })

  it('removes an entry via its remove button', async () => {
    render(<TrustedSendersCard entries={ENTRIES} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: /remove jane@acme\.com/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['partner.io']))
  })

  it('rejects an implausible entry without saving', () => {
    render(<TrustedSendersCard entries={ENTRIES} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/add trusted sender/i), {
      target: { value: 'not an address' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/valid email address or domain/i)).toBeTruthy()
  })

  it('rejects a duplicate entry without saving', () => {
    render(<TrustedSendersCard entries={ENTRIES} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText(/add trusted sender/i), {
      target: { value: 'JANE@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/already on the list/i)).toBeTruthy()
  })
})
