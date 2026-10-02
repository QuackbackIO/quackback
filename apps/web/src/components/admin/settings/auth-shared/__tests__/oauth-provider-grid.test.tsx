// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OAuthProviderGrid } from '../oauth-provider-grid'

function renderGrid(over: Partial<React.ComponentProps<typeof OAuthProviderGrid>> = {}) {
  const props = {
    enabled: {},
    credentialStatus: {},
    isLastMethod: () => false,
    onToggle: vi.fn(),
    onConfigure: vi.fn(),
    ...over,
  }
  render(<OAuthProviderGrid {...props} />)
  return props
}

describe('OAuthProviderGrid', () => {
  afterEach(cleanup)

  it('draws unconfigured providers quietly: no badge, full-colour logo', () => {
    renderGrid()
    expect(screen.queryByText('Not configured')).toBeNull()
    const tile = screen.getByRole('button', { name: /Configure Google/ })
    expect(tile.querySelector('.opacity-60')).toBeNull()
  })

  it('opens the credentials dialog from an unconfigured tile', () => {
    const { onConfigure } = renderGrid()
    fireEvent.click(screen.getByRole('button', { name: /Configure Google/ }))
    expect(onConfigure).toHaveBeenCalledWith(expect.objectContaining({ id: 'google' }))
  })

  it('marks only configured providers that are on with the On badge', () => {
    renderGrid({
      credentialStatus: { google: true, github: true },
      enabled: { google: true, github: false },
    })
    expect(screen.getAllByText('On')).toHaveLength(1)
    expect(screen.queryByText('Enabled')).toBeNull()
  })
})
