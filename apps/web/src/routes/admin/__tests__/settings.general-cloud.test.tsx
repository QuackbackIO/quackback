// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CloudWorkspaceDetails } from '../settings.general'

describe('cloud workspace details', () => {
  it('shows one primary action with name and Quackback URL controls', () => {
    const save = vi.fn()
    render(
      <CloudWorkspaceDetails
        workspaceName="Untitled workspace"
        platformLabel="ws-generated"
        domainSuffix="quackback.co.uk"
        currentOrigin="https://ws-generated.quackback.co.uk"
        pending={false}
        error={null}
        onWorkspaceNameChange={vi.fn()}
        onPlatformLabelChange={vi.fn()}
        onSubmit={save}
      />
    )

    expect(screen.getByLabelText('Workspace name')).toBeInTheDocument()
    expect(screen.getByLabelText('Quackback URL')).toBeInTheDocument()
    expect(screen.getByText(/Preview:/)).toHaveTextContent('https://ws-generated.quackback.co.uk')
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(save).toHaveBeenCalledOnce()
  })
})
