// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const settings = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => settings.current,
}))

import { useWorkspaceAnnouncesOnLauncher } from '../use-workspace-announces'

function announces(publicWidgetConfig: unknown): boolean {
  settings.current = { publicWidgetConfig }
  return renderHook(() => useWorkspaceAnnouncesOnLauncher()).result.current
}

describe('useWorkspaceAnnouncesOnLauncher', () => {
  it('is on when the widget is on and announces new updates', () => {
    expect(announces({ enabled: true, changelog: { announceOnLauncher: true } })).toBe(true)
  })

  it('is off when the widget does not announce, or is off altogether', () => {
    expect(announces({ enabled: true, changelog: { announceOnLauncher: false } })).toBe(false)
    expect(announces({ enabled: false, changelog: { announceOnLauncher: true } })).toBe(false)
    expect(announces(undefined)).toBe(false)
  })
})
