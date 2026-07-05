// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ConnectorInputsEditor } from '../connector-inputs-editor'
import type { ConnectorInputField } from '@/lib/server/domains/connectors/connector.types'

afterEach(cleanup)

function Harness({ initial = [] as ConnectorInputField[] }) {
  const [inputs, setInputs] = useState<ConnectorInputField[]>(initial)
  return (
    <div>
      <ConnectorInputsEditor inputs={inputs} onChange={setInputs} />
      <output data-testid="count">{inputs.length}</output>
    </div>
  )
}

describe('<ConnectorInputsEditor>', () => {
  it('shows an empty hint with no inputs', () => {
    render(<Harness />)
    expect(screen.getByText('No declared inputs.')).toBeInTheDocument()
  })

  it('adds a blank input row defaulting to type string', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Add input' }))
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByLabelText('Input 1 name')).toHaveValue('')
  })

  it('updates the name field for an existing row', () => {
    render(<Harness initial={[{ name: '', type: 'string' }]} />)
    fireEvent.change(screen.getByLabelText('Input 1 name'), { target: { value: 'order_id' } })
    expect(screen.getByLabelText('Input 1 name')).toHaveValue('order_id')
  })

  it('removes a row, shifting the remaining one up', () => {
    render(
      <Harness
        initial={[
          { name: 'a', type: 'string' },
          { name: 'b', type: 'string' },
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove input 1' }))
    expect(screen.getByTestId('count')).toHaveTextContent('1')
    expect(screen.getByLabelText('Input 1 name')).toHaveValue('b')
  })

  it('toggles required', () => {
    render(<Harness initial={[{ name: 'a', type: 'string', required: false }]} />)
    fireEvent.click(screen.getByLabelText('Input 1 required'))
    expect(screen.getByLabelText('Input 1 required')).toBeChecked()
  })
})
