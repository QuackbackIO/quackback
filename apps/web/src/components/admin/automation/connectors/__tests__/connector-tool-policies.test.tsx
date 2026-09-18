// @vitest-environment happy-dom
/**
 * The Connections page's per-use permission grid.
 *
 * What is worth testing here is what the page promises the operator: that the
 * two columns write two different records, that a write carries the version it
 * was edited from, and that a rejected write keeps what they were editing
 * instead of snapping back to the server's value.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConnectorDTO } from '@/lib/shared/assistant/connectors'

const hoisted = vi.hoisted(() => ({
  updateConnectorFn: vi.fn(),
  reviewConnectorToolsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-connectors', () => ({
  createConnectorFn: vi.fn(),
  deleteConnectorFn: vi.fn(),
  refreshConnectorFn: vi.fn(),
  reviewConnectorToolsFn: hoisted.reviewConnectorToolsFn,
  startConnectorOAuthFn: vi.fn(),
  updateConnectorFn: hoisted.updateConnectorFn,
  listConnectorsFn: vi.fn(),
  getConnectorFn: vi.fn(),
}))

import { ConnectorToolPolicies } from '../connector-tool-policies'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function tool(
  overrides: Partial<ConnectorDTO['tools'][number]> = {}
): ConnectorDTO['tools'][number] {
  return {
    name: 'issue_refund',
    title: 'Issue refund',
    description: 'Refund a charge',
    group: 'write',
    destructive: false,
    policies: {
      agent: { policy: 'approval', reason: 'group_default', isOverride: false },
      copilot: { policy: 'approval', reason: 'group_default', isOverride: false },
      workspace: { policy: 'never', reason: 'no_profile_policy', isOverride: false },
    },
    review: { state: 'reviewed', changes: [] },
    schemaSupported: true,
    isNew: false,
    ...overrides,
  }
}

function connector(overrides: Partial<ConnectorDTO> = {}): ConnectorDTO {
  return {
    id: 'connector_1',
    name: 'Acme',
    slug: 'acme',
    url: 'https://example.test/mcp',
    authMode: 'none',
    hasSecret: false,
    status: 'connected',
    enabled: true,
    assignments: { agent: true, copilot: true },
    profilePolicies: {
      agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
      copilot: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
    },
    policyVersion: 4,
    catalogRevision: 2,
    tools: [tool()],
    toolCount: 1,
    unreviewedCount: 0,
    lastSyncedAt: null,
    lastCallAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderGrid(dto: ConnectorDTO): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>
        <ConnectorToolPolicies connector={dto} />
      </QueryClientProvider>
    </IntlProvider>
  )
  return <></>
}

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

describe('ConnectorToolPolicies', () => {
  it('writes only the use whose column was changed, with the version it was edited from', async () => {
    hoisted.updateConnectorFn.mockResolvedValue(null)
    renderGrid(connector())

    await choose('Issue refund: Customer conversations', 'Never')

    await waitFor(() => expect(hoisted.updateConnectorFn).toHaveBeenCalled())
    const sent = hoisted.updateConnectorFn.mock.calls[0]![0].data
    expect(sent.expectedPolicyVersion).toBe(4)
    expect(sent.profilePolicies.agent.tools).toEqual({ issue_refund: 'never' })
    expect(sent.profilePolicies.copilot.tools).toEqual({})
  })

  it('resets one use back to its group default without touching the other', async () => {
    hoisted.updateConnectorFn.mockResolvedValue(null)
    renderGrid(
      connector({
        profilePolicies: {
          agent: { groupDefaults: { read: 'always', write: 'approval' }, tools: {} },
          copilot: {
            groupDefaults: { read: 'always', write: 'approval' },
            tools: { issue_refund: 'never' },
          },
        },
      })
    )

    await choose('Issue refund: Support teammates', 'Needs approval (default)')

    await waitFor(() => expect(hoisted.updateConnectorFn).toHaveBeenCalled())
    const sent = hoisted.updateConnectorFn.mock.calls[0]![0].data
    expect(sent.profilePolicies.copilot.tools).toEqual({})
    expect(sent.profilePolicies.agent.tools).toEqual({})
  })

  it('keeps the edit on screen when the server refuses a stale version', async () => {
    hoisted.updateConnectorFn.mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'CONNECTOR_POLICY_CONFLICT' })
    )
    renderGrid(connector())

    await choose('Issue refund: Customer conversations', 'Never')

    await waitFor(() => expect(hoisted.updateConnectorFn).toHaveBeenCalled())
    // The server still says "approval"; the editor still shows what they chose.
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Issue refund: Customer conversations' })
      ).toHaveTextContent('Never')
    )
  })

  it('offers review for a changed contract and says what moved', async () => {
    hoisted.reviewConnectorToolsFn.mockResolvedValue(null)
    renderGrid(
      connector({
        tools: [tool({ review: { state: 'changed', changes: ['input schema'] } })],
        unreviewedCount: 1,
      })
    )

    expect(screen.getByText(/input schema changed/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }))

    await waitFor(() => expect(hoisted.reviewConnectorToolsFn).toHaveBeenCalled())
    expect(hoisted.reviewConnectorToolsFn.mock.calls[0]![0].data).toEqual({
      id: 'connector_1',
      toolNames: ['issue_refund'],
      expectedCatalogRevision: 2,
    })
  })

  it('offers no control for a tool whose input schema cannot be enforced', () => {
    renderGrid(
      connector({
        tools: [
          tool({ schemaSupported: false, schemaIssue: 'uses the unsupported keyword "$ref"' }),
        ],
      })
    )

    expect(screen.queryByRole('combobox', { name: /Issue refund/ })).toBeNull()
    expect(screen.getByText(/unsupported keyword/)).toBeTruthy()
  })
})
