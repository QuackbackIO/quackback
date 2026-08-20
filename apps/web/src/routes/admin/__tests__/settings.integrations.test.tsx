// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/admin/settings/integrations/integration-list', () => ({
  IntegrationList: () => <p>integration catalog</p>,
}))
vi.mock('@/components/admin/upgrade', () => ({
  UpgradeScreen: ({ description }: { description: { body: string } }) => <p>{description.body}</p>,
}))

const { IntegrationsSettingsBody } = await import('../settings.integrations.index')

describe('integrations settings page', () => {
  it('shows the in-route upgrade screen when integrations are off', () => {
    render(<IntegrationsSettingsBody enabled={false} catalog={[]} integrations={[]} />)
    expect(screen.getByText(/Integrations is a Pro feature/)).toBeTruthy()
    expect(screen.queryByText('integration catalog')).toBeNull()
  })

  it('shows the catalog when integrations are on', () => {
    render(<IntegrationsSettingsBody enabled catalog={[]} integrations={[]} />)
    expect(screen.getByText('integration catalog')).toBeTruthy()
    expect(screen.queryByText(/Integrations is a Pro feature/)).toBeNull()
  })
})
