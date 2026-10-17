// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PortalFilterSheet } from '../portal-filter-sheet'

afterEach(cleanup)

function renderSheet(activeCount: number) {
  render(
    <IntlProvider locale="en">
      <PortalFilterSheet activeCount={activeCount}>
        <p>Panel content</p>
      </PortalFilterSheet>
    </IntlProvider>
  )
}

describe('PortalFilterSheet', () => {
  it('says how many filters are on', () => {
    renderSheet(2)
    expect(screen.getByRole('button', { name: /Filters, 2 on/ })).toBeInTheDocument()
  })

  it('opens the panel in a sheet and Done closes it', async () => {
    renderSheet(0)
    expect(screen.queryByText('Panel content')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByText('Panel content')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('Panel content')).not.toBeInTheDocument())
  })
})
