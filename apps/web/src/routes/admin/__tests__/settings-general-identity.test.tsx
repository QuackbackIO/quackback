// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CloudWorkspaceDetails, LocalWorkspaceNameCard } from '../settings.general'

describe('General workspace identity', () => {
  it('self-host name card has no cloud URL field', () => {
    render(
      <LocalWorkspaceNameCard
        workspaceName="Acme"
        saving={false}
        managed={false}
        onWorkspaceNameChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Workspace Name')).toHaveValue('Acme')
    expect(screen.queryByLabelText('Quackback URL')).not.toBeInTheDocument()
    expect(screen.queryByText(/Friendly Quackback URL/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ws-/)).not.toBeInTheDocument()
  })

  it('cloud details do not prefill a generated host into the URL field', () => {
    render(
      <CloudWorkspaceDetails
        workspaceName="Track1 Alpha"
        platformLabel=""
        domainSuffix="quackback.co.uk"
        currentOrigin="https://south63792f.quackback.co.uk"
        pending={false}
        error={null}
        onWorkspaceNameChange={vi.fn()}
        onPlatformLabelChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Quackback URL')).toHaveValue('')
    expect(screen.queryByDisplayValue(/ws-/)).not.toBeInTheDocument()
  })
})
