// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { describe, expect, it, vi } from 'vitest'
import { CloudUseCaseForm } from '../_layout.usecase'
import { CloudWorkspaceDetailsForm } from '../_layout.workspace'

const IDENTITY = {
  version: 1,
  displayName: 'Untitled workspace',
  canonicalOrigin: 'https://ws-a1b2c3.quackback.co.uk',
  platformHostname: null,
  customDomains: [],
  updatedAt: '2026-08-14T12:00:00.000Z',
}

function primaryButtons(): HTMLElement[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.className.split(' ').includes('bg-primary'))
}

describe('cloud post-handoff onboarding', () => {
  it('requires a friendly URL, hides the generated host, and has one primary action', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<CloudWorkspaceDetailsForm identity={IDENTITY} onSave={save} />)

    expect(screen.getByLabelText('Workspace name')).toHaveValue('Untitled workspace')
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('')
    expect(screen.queryByText(/Current address:/)).not.toBeInTheDocument()
    expect(screen.queryByText(IDENTITY.canonicalOrigin)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Skip/ })).not.toBeInTheDocument()
    expect(primaryButtons()).toHaveLength(1)

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeDisabled()
    fireEvent.click(continueButton)
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Workspace URL'), {
      target: { value: 'awesome' },
    })
    expect(continueButton).toBeEnabled()
    fireEvent.click(continueButton)
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        displayName: 'Untitled workspace',
        platformLabel: 'awesome',
      })
    )
  })

  it('does not prefill a generated system host into the URL field', () => {
    render(
      <CloudWorkspaceDetailsForm
        identity={{
          ...IDENTITY,
          platformHostname: 'ws-4a048e07941c5e7840e986c0.quackback.co.uk',
        }}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Workspace URL')).toHaveValue('')
    expect(screen.queryByText(/ws-4a048e07941c5e7840e986c0/)).not.toBeInTheDocument()
  })

  it('keeps the Quackback suffix when a custom domain is canonical', () => {
    render(
      <CloudWorkspaceDetailsForm
        identity={{
          ...IDENTITY,
          canonicalOrigin: 'https://feedback.example.com',
          platformHostname: 'awesome.quackback.co.uk',
        }}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByText('.quackback.co.uk')).toBeInTheDocument()
    expect(screen.queryByText('.example.com')).not.toBeInTheDocument()
  })

  it('keeps the outcome screen to one primary action', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(
      <IntlProvider locale="en" messages={{}}>
        <CloudUseCaseForm onSave={save} />
      </IntlProvider>
    )

    expect(primaryButtons()).toHaveLength(1)
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Product feedback/ }))
    expect(continueButton).toBeEnabled()
    fireEvent.click(continueButton)
    await waitFor(() => expect(save).toHaveBeenCalledWith('product_feedback'))
  })
})
