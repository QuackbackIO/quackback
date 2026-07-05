// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConnectorHeadersEditor } from '../connector-headers-editor'
import type { ConnectorHeader } from '@/lib/server/domains/connectors/connector.types'

afterEach(cleanup)

function Harness({ initial = [] as ConnectorHeader[] }) {
  const [headers, setHeaders] = useState<ConnectorHeader[]>(initial)
  return (
    <div>
      <ConnectorHeadersEditor headers={headers} onChange={setHeaders} />
      <output data-testid="count">{headers.length}</output>
    </div>
  )
}

describe('<ConnectorHeadersEditor>', () => {
  it('shows an empty hint with no headers', () => {
    render(<Harness />)
    expect(screen.getByText('No custom headers.')).toBeInTheDocument()
  })

  it('adds a blank header row', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }))
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByLabelText('Header 1 name')).toHaveValue('')
  })

  it('updates the value field for an existing row', () => {
    render(<Harness initial={[{ name: 'X-Api-Version', value: '' }]} />)
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: '2024-01-01' } })
    expect(screen.getByLabelText('Header 1 value')).toHaveValue('2024-01-01')
  })

  it('removes a row', () => {
    render(
      <Harness
        initial={[
          { name: 'a', value: '1' },
          { name: 'b', value: '2' },
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove header 1' }))
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByLabelText('Header 1 name')).toHaveValue('b')
  })
})
