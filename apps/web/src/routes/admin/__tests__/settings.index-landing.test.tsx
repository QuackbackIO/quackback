// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  navigate: vi.fn(),
  flags: {} as Record<string, boolean>,
  permissions: new Set<string>(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  useNavigate: () => hoisted.navigate,
}))
vi.mock('@/lib/client/hooks/use-media-query', () => ({ useMediaQuery: () => true }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useFeatureFlags: () => hoisted.flags,
  useBillingEnabled: () => false,
  useCloudEnabled: () => false,
}))
vi.mock('@/lib/client/use-permissions', () => ({ usePermissions: () => hoisted.permissions }))
vi.mock('@/components/admin/settings/settings-nav', () => ({ SettingsNav: () => null }))
vi.mock('@/components/admin/settings/settings-page', () => ({
  SettingsPage: () => null,
}))

const { Route } = await import('../settings.index')

function renderIndex(permissions: PermissionKey[], flags: Record<string, boolean> = {}) {
  hoisted.permissions = new Set(permissions)
  hoisted.flags = flags
  const Page = (Route as unknown as { options: { component: () => ReactNode } }).options.component
  render(<Page />)
}

describe('settings index on desktop', () => {
  afterEach(() => {
    cleanup()
    hoisted.navigate.mockClear()
  })

  it('opens General for a viewer who may open it', () => {
    renderIndex([PERMISSIONS.SETTINGS_MANAGE])
    expect(hoisted.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/general',
      replace: true,
    })
  })

  it('opens the first page a viewer without settings.manage can open', () => {
    renderIndex([PERMISSIONS.ASSISTANT_MANAGE])
    expect(hoisted.navigate).toHaveBeenCalledWith({ to: '/admin/settings/agent', replace: true })
  })

  it('opens Notifications for a viewer with no settings permission', () => {
    renderIndex([])
    expect(hoisted.navigate).toHaveBeenCalledWith({
      to: '/admin/settings/notifications',
      replace: true,
    })
  })
})
