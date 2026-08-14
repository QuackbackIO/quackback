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
  it('offers optional details with one primary action and no generated-label submission', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(
      <CloudWorkspaceDetailsForm
        identity={IDENTITY}
        onSave={save}
        onSkip={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(screen.getByLabelText('Workspace name')).toHaveValue('Untitled workspace')
    expect(screen.getByLabelText(/Friendly Quackback URL/)).toHaveValue('')
    expect(screen.getByText(/Current address:/)).toHaveTextContent(IDENTITY.canonicalOrigin)
    expect(primaryButtons()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ displayName: 'Untitled workspace' }))
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
