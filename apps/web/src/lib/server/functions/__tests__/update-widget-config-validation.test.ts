/**
 * The widget config save validates its input before it reaches the settings
 * service: the launcher announcement switch is kept, and a malformed value
 * is refused. Exercised through the server function itself, with its input
 * validator applied as the server applies it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  updateWidgetConfig: vi.fn(),
}))

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-start')>()
  const createServerFn = () => {
    let schema: { parse: (data: unknown) => unknown } | null = null
    const builder = {
      validator: (s: typeof schema) => {
        schema = s
        return builder
      },
      inputValidator: (s: typeof schema) => {
        schema = s
        return builder
      },
      middleware: () => builder,
      handler: (fn: (ctx: { data: unknown }) => unknown) => (opts?: { data?: unknown }) =>
        Promise.resolve().then(() => fn({ data: schema ? schema.parse(opts?.data) : opts?.data })),
    }
    return builder
  }
  return { ...actual, createServerFn }
})

vi.mock('../auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth-helpers')>()),
  requireAuth: state.requireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.widget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.widget')>()),
  updateWidgetConfig: state.updateWidgetConfig,
}))

const { updateWidgetConfigFn } = await import('../settings')

beforeEach(() => {
  state.requireAuth.mockReset().mockResolvedValue({
    settings: { id: 'workspace_1' },
    principal: { id: 'principal_1' },
  })
  state.updateWidgetConfig.mockReset().mockImplementation(async (input: unknown) => input)
})

describe('updateWidgetConfigFn launcher announcement', () => {
  it('saves the switch under the changelog settings', async () => {
    await updateWidgetConfigFn({ data: { changelog: { announceOnLauncher: true } } })
    expect(state.updateWidgetConfig).toHaveBeenCalledWith({
      changelog: { announceOnLauncher: true },
    })
  })

  it('refuses a non-boolean switch without saving', async () => {
    await expect(
      updateWidgetConfigFn({ data: { changelog: { announceOnLauncher: 'yes' } } as never })
    ).rejects.toThrow()
    expect(state.updateWidgetConfig).not.toHaveBeenCalled()
  })
})

describe('updateWidgetConfigFn reply alerts', () => {
  it('saves the reply alert style and the tab title switch under the messenger', async () => {
    await updateWidgetConfigFn({ data: { messenger: { replyAlerts: 'full', titleAlerts: true } } })
    expect(state.updateWidgetConfig).toHaveBeenCalledWith({
      messenger: { replyAlerts: 'full', titleAlerts: true },
    })
  })

  it('accepts each reply alert style', async () => {
    for (const replyAlerts of ['badge', 'preview', 'full'] as const) {
      await updateWidgetConfigFn({ data: { messenger: { replyAlerts } } })
      expect(state.updateWidgetConfig).toHaveBeenLastCalledWith({ messenger: { replyAlerts } })
    }
  })

  it('refuses an unknown style or a non-boolean switch without saving', async () => {
    await expect(
      updateWidgetConfigFn({ data: { messenger: { replyAlerts: 'loud' } } as never })
    ).rejects.toThrow()
    await expect(
      updateWidgetConfigFn({ data: { messenger: { titleAlerts: 'yes' } } as never })
    ).rejects.toThrow()
    expect(state.updateWidgetConfig).not.toHaveBeenCalled()
  })
})
