// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Autocomplete } from '../autocomplete'

// Radix Popover + cmdk touch these APIs that happy-dom does not implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

const opts = [{ value: 'roles' }, { value: 'groups' }]

describe('Autocomplete', () => {
  it('shows the placeholder and opens to its suggestions', () => {
    render(
      <Autocomplete
        value=""
        onValueChange={vi.fn()}
        placeholder="pick…"
        ariaLabel="Claim path"
        suggestions={opts}
      />
    )
    const trigger = screen.getByRole('combobox', { name: 'Claim path' })
    expect(trigger).toHaveTextContent('pick…')
    fireEvent.click(trigger)
    expect(screen.getByText('roles')).toBeInTheDocument()
    expect(screen.getByText('groups')).toBeInTheDocument()
  })

  it('commits a selected suggestion', () => {
    const onValueChange = vi.fn()
    render(
      <Autocomplete
        value=""
        onValueChange={onValueChange}
        ariaLabel="Claim path"
        suggestions={opts}
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path' }))
    fireEvent.click(screen.getByText('roles'))
    expect(onValueChange).toHaveBeenCalledWith('roles')
  })

  it('commits free text the suggestions do not contain', () => {
    const onValueChange = vi.fn()
    render(
      <Autocomplete
        value=""
        onValueChange={onValueChange}
        ariaLabel="Claim path"
        suggestions={opts}
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path' }))
    fireEvent.change(screen.getByPlaceholderText('Search or type…'), {
      target: { value: 'realm_access.roles' },
    })
    fireEvent.click(screen.getByText(/Use [""]realm_access\.roles[""]/))
    expect(onValueChange).toHaveBeenCalledWith('realm_access.roles')
  })

  it('shows the empty hint when there are no suggestions', () => {
    render(
      <Autocomplete
        value=""
        onValueChange={vi.fn()}
        ariaLabel="Claim path"
        suggestions={[]}
        emptyHint="Run a test sign-in."
      />
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Claim path' }))
    expect(screen.getByText('Run a test sign-in.')).toBeInTheDocument()
  })
})
