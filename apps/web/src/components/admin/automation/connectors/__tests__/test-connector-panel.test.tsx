// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { ConnectorInputField } from '@/lib/server/domains/connectors/connector.types'

const mutate = vi.fn()
vi.mock('@/lib/client/mutations/connectors', () => ({
  useTestConnector: () => ({ mutate, isPending: false }),
}))

import { TestConnectorPanel } from '../test-connector-panel'

afterEach(() => {
  cleanup()
  mutate.mockReset()
})

const inputs: ConnectorInputField[] = [
  { name: 'order_id', type: 'string', required: true },
  { name: 'qty', type: 'number' },
  { name: 'urgent', type: 'boolean' },
]

function renderPanel() {
  return render(
    <TestConnectorPanel
      connectorId={'data_connector_1' as never}
      inputs={inputs}
      method="POST"
      urlTemplate="https://api.example.com/orders/{order_id}"
      bodyTemplate={'{"qty": "{qty}"}'}
    />
  )
}

describe('<TestConnectorPanel>', () => {
  it('renders a field per declared input', () => {
    renderPanel()
    expect(screen.getByLabelText('order_id')).toBeInTheDocument()
    expect(screen.getByLabelText('qty')).toBeInTheDocument()
    expect(screen.getByLabelText('urgent')).toBeInTheDocument()
  })

  it('shows a live request preview as sample values are entered', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('order_id'), { target: { value: '123' } })
    expect(screen.getByText('POST https://api.example.com/orders/123')).toBeInTheDocument()
  })

  it('runs the test with only the filled-in sample values', () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('order_id'), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText('qty'), { target: { value: '5' } })
    fireEvent.click(screen.getByLabelText('urgent'))

    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    const [payload] = mutate.mock.calls[0]!
    expect(payload).toEqual({
      id: 'data_connector_1',
      sampleValues: { order_id: '123', qty: 5, urgent: true },
    })
  })

  it('renders the captured response on a successful call', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))

    const opts = mutate.mock.calls[0]![1] as {
      onSuccess: (r: { ok: true; status: number; data: unknown }) => void
    }
    act(() => {
      opts.onSuccess({ ok: true, status: 200, data: { total: 42 } })
    })

    expect(screen.getByText('Success (HTTP 200)')).toBeInTheDocument()
    expect(screen.getByText(/"total": 42/)).toBeInTheDocument()
  })

  it('renders a friendly error for a failed call', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))

    const opts = mutate.mock.calls[0]![1] as {
      onSuccess: (r: { ok: false; reason: string; status: number; message: string }) => void
    }
    act(() => {
      opts.onSuccess({ ok: false, reason: 'http_error', status: 500, message: 'HTTP 500' })
    })

    expect(screen.getByText('HTTP error (500)')).toBeInTheDocument()
    expect(screen.getByText('HTTP 500')).toBeInTheDocument()
  })
})
