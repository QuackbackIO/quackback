// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DataConnector } from '@/lib/server/domains/connectors/connector.types'

const createMutate = vi.fn()
const updateMutate = vi.fn()
const testMutate = vi.fn()

vi.mock('@/lib/client/mutations/connectors', () => ({
  useCreateConnector: () => ({ mutate: createMutate, isPending: false }),
  useUpdateConnector: () => ({ mutate: updateMutate, isPending: false }),
  useTestConnector: () => ({ mutate: testMutate, isPending: false }),
}))

import { ConnectorFormDialog } from '../connector-form-dialog'

afterEach(() => {
  cleanup()
  createMutate.mockReset()
  updateMutate.mockReset()
  testMutate.mockReset()
})

const existingConnector: DataConnector = {
  id: 'data_connector_1' as never,
  name: 'Look up order',
  slug: 'look_up_order',
  description: 'Looks up an order by id',
  method: 'POST',
  urlTemplate: 'https://api.example.com/orders/{order_id}',
  headers: [],
  auth: { type: 'bearer' },
  hasSecret: true,
  inputs: [{ name: 'order_id', type: 'string', required: true }],
  bodyTemplate: '{"id": "{order_id}"}',
  exampleResponse: null,
  responsePaths: null,
  timeoutMs: 10000,
  enabled: true,
  status: 'active',
  failureCount: 0,
  lastError: null,
  lastTestedAt: null,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('<ConnectorFormDialog> create mode', () => {
  it('disables Create until the required fields are filled', () => {
    render(<ConnectorFormDialog connector={null} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Create connector' })).toBeDisabled()
  })

  it('submits a create payload without a secret key when none is entered', () => {
    render(<ConnectorFormDialog connector={null} open onOpenChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Look up order' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Looks up an order by id' },
    })
    fireEvent.change(screen.getByLabelText('URL template'), {
      target: { value: 'https://api.example.com/orders/{order_id}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create connector' }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    const [payload] = createMutate.mock.calls[0]!
    expect(payload).toMatchObject({
      name: 'Look up order',
      description: 'Looks up an order by id',
      method: 'GET',
      urlTemplate: 'https://api.example.com/orders/{order_id}',
      enabled: false,
    })
    expect(payload).not.toHaveProperty('secret')
  })

  it('shows a hint instead of the test panel before the connector is saved', () => {
    render(<ConnectorFormDialog connector={null} open onOpenChange={vi.fn()} />)
    expect(
      screen.getByText('Save the connector first, then edit it to run a test call.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Test connector')).not.toBeInTheDocument()
  })
})

describe('<ConnectorFormDialog> edit mode', () => {
  it('pre-fills fields from the existing connector', () => {
    render(<ConnectorFormDialog connector={existingConnector} open onOpenChange={vi.fn()} />)
    expect(screen.getByLabelText('Name')).toHaveValue('Look up order')
    expect(screen.getByLabelText('URL template')).toHaveValue(
      'https://api.example.com/orders/{order_id}'
    )
  })

  it('shows the "leave blank to keep" placeholder and omits secret when untouched', () => {
    render(<ConnectorFormDialog connector={existingConnector} open onOpenChange={vi.fn()} />)
    expect(screen.getByLabelText('Secret')).toHaveAttribute(
      'placeholder',
      'Leave blank to keep the current secret'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(updateMutate).toHaveBeenCalledTimes(1)
    const [payload] = updateMutate.mock.calls[0]!
    expect(payload).not.toHaveProperty('secret')
    expect(payload).not.toHaveProperty('clearSecret')
  })

  it('sends the new secret when one is typed', () => {
    render(<ConnectorFormDialog connector={existingConnector} open onOpenChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Secret'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const [payload] = updateMutate.mock.calls[0]!
    expect(payload).toMatchObject({ secret: 'new-secret' })
  })

  it('sends clearSecret and no secret when "Clear the stored secret" is checked', () => {
    render(<ConnectorFormDialog connector={existingConnector} open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Clear the stored secret'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const [payload] = updateMutate.mock.calls[0]!
    expect(payload).toMatchObject({ clearSecret: true })
    expect(payload).not.toHaveProperty('secret')
  })

  it('renders the test panel once editing a saved connector', () => {
    render(<ConnectorFormDialog connector={existingConnector} open onOpenChange={vi.fn()} />)
    expect(screen.getByText('Test connector')).toBeInTheDocument()
  })
})
