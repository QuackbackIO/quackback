// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { getConnectUrl, removeIntegration } = vi.hoisted(() => ({
  getConnectUrl: vi.fn(),
  removeIntegration: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, isFetching: false }),
  useQueryClient: () => ({ fetchQuery: vi.fn() }),
}))
vi.mock('@/lib/client/queries/admin', () => ({ adminQueries: { boards: () => ({}) } }))
vi.mock('@/lib/client/mutations', () => ({
  useUpdateIntegration: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteIntegration: () => ({ mutate: removeIntegration, isPending: false }),
}))
vi.mock('@/integrations/slack/server/functions', () => ({
  getSlackConnectUrl: getConnectUrl,
  fetchSlackChannelsFn: vi.fn(),
}))
vi.mock('../slack-agent-card', () => ({ SlackAgentCard: () => null }))
vi.mock('@/components/admin/settings/integrations/shared/notification-channel-router', () => ({
  NotificationChannelRouter: () => null,
}))
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { SlackConfig } from '../slack-config'
import { SLACK_REQUIRED_SCOPES } from '../../scopes'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
function show(scopes: string) {
  render(
    <SlackConfig
      integrationId="int_existing"
      initialConfig={{ scopes }}
      initialEventMappings={[]}
      enabled
    />
  )
}

describe('Slack scope reconnect', () => {
  it('gets a signed URL through the existing connect flow without disconnecting', async () => {
    const url = '/oauth/slack/connect?state=signed-state'
    getConnectUrl.mockResolvedValue(url)
    show('chat:write')
    expect(screen.queryByRole('link', { name: 'Reconnect Slack' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Slack' }))
    await waitFor(() => expect(getConnectUrl).toHaveBeenCalledOnce())
    await waitFor(() => expect(window.location.href).toContain(url))
    expect(removeIntegration).not.toHaveBeenCalled()
  })

  it('does not offer scope reconnect when all required permissions were granted', () => {
    show(SLACK_REQUIRED_SCOPES.join(','))
    expect(screen.queryByRole('button', { name: 'Reconnect Slack' })).toBeNull()
  })
})
