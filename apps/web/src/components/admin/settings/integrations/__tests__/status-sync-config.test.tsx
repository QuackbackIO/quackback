// @vitest-environment happy-dom
/**
 * <StatusSyncConfig> — webhook secret surfacing for manual integrations.
 *
 * Manual-webhook platforms (Shortcut, Azure DevOps) can't auto-register their
 * webhook, so the admin must paste both the URL *and* the signing secret into
 * the external platform. The secret must therefore be visible in the UI.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusSyncConfig } from '../status-sync-config'

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({ data: [] }),
}))

const idleMutation = { mutate: vi.fn(), isPending: false, isError: false, error: null }
vi.mock('@/lib/client/mutations', () => ({
  useEnableStatusSync: () => idleMutation,
  useDisableStatusSync: () => idleMutation,
  useUpdateStatusMappings: () => idleMutation,
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { statuses: () => ({ queryKey: ['statuses'], queryFn: async () => [] }) },
}))

afterEach(cleanup)

const SECRET = 'whsec_test_secret_123'

function renderConfig(overrides: Record<string, unknown> = {}) {
  return render(
    <StatusSyncConfig
      integrationId="int_1"
      integrationType="shortcut"
      config={{ statusSyncEnabled: true, webhookSecret: SECRET }}
      enabled
      externalStatuses={[]}
      isManual
      {...overrides}
    />
  )
}

describe('StatusSyncConfig — manual webhook secret', () => {
  it('renders the webhook signing secret for a manual integration', () => {
    renderConfig()
    expect(screen.getByText(SECRET)).toBeTruthy()
  })

  it('does not render the secret for an auto-registered integration', () => {
    renderConfig({ isManual: false })
    expect(screen.queryByText(SECRET)).toBeNull()
  })
})
